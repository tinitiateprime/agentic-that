import path from "node:path";
import { accessErrorResponse, assertPrincipalCapability, authorizeApiCapability, principalHasAccess } from "@platform/server/access-control";
import {
  advanceCentralStagedUpload,
  advanceCentralStagedUploadParts,
  centralMediaFileName,
  createCentralAccount,
  createCentralSchedule,
  createCentralStagedUpload,
  createCentralSubmission,
  createCentralUploads,
  createCompanionPairing,
  deleteCentralAccount,
  deleteCentralSchedule,
  deleteCentralStagedUpload,
  deleteCentralUpload,
  finalizeCentralStagedUpload,
  getCentralCompanion,
  getCentralStagedUpload,
  listCentralAccounts,
  listCentralSchedules,
  listCentralSubmissions,
  listCentralUploads,
  minimumCompanionVersion,
  publishingDashboard,
  publishingWorkspaceSnapshot,
  publishingWorkspaceMediaRecord,
  publishingUserFromPrincipal,
  queueCentralUploads,
  removeCentralCompanion,
  scheduleCentralSubmission,
  updateCentralAccount,
  updateCentralSchedule,
  updateCentralUpload,
  updateCentralUploadStatus,
} from "@platform/server/publishing-central-store";
import { deletePublishingMedia } from "../../../../services/publishing/queue-runner/server/media-storage.ts";
import { publishingMediaResponse } from "@platform/server/publishing-media-response";
import { after } from "next/server";
import { storePublishingPreviewInput } from "@platform/server/publishing-media-preview";
import { runDueRedditApiJobs } from "@platform/server/reddit-publishing";
import {
  authorizeSupabaseJobArtifactPartUploads,
  deleteSupabaseJobArtifactParts,
  deleteSupabaseStagedArtifactParts,
  finalizeSupabaseJobArtifact,
  storeSupabaseJobArtifactPart,
  SUPABASE_ARTIFACT_PART_THRESHOLD_BYTES,
  verifySupabaseJobArtifactPartUploads,
} from "@platform/server/supabase-job-control";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_CHUNK_BYTES = 2 * 1024 * 1024;

function fail(error) {
  try {
    return accessErrorResponse(error);
  } catch {
    return Response.json({ message: error instanceof Error ? error.message : "The publishing request failed." }, { status: 400 });
  }
}

async function segments(context) {
  const params = await context.params;
  return (params?.path || []).map((value) => decodeURIComponent(String(value)));
}

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  return value === true || value === "true";
}

function requestedArtifactParts(stage, input) {
  const values = Array.isArray(input?.parts) ? input.parts : [input];
  if (values.length < 1 || values.length > 8) throw new Error("The private media upload batch is invalid.");
  const parts = values.map((value) => ({
    index: Number(value?.index),
    offset: Number(value?.offset),
    byteSize: Number(value?.byteSize),
  })).sort((left, right) => left.offset - right.offset);
  let expectedOffset = parts[0]?.offset;
  const indexes = new Set();
  for (const part of parts) {
    const expectedByteSize = Number.isInteger(part.offset) ? Math.min(stage.chunkSize, stage.size - part.offset) : 0;
    if (!Number.isInteger(part.offset) || part.offset < 0 || part.offset % stage.chunkSize !== 0
      || expectedByteSize < 1 || !Number.isInteger(part.index) || part.index !== Math.floor(part.offset / stage.chunkSize)
      || indexes.has(part.index) || !Number.isInteger(part.byteSize) || part.byteSize !== expectedByteSize
      || part.offset + part.byteSize > stage.size || part.offset !== expectedOffset) {
      throw new Error("The private media parts do not match the upload session.");
    }
    indexes.add(part.index);
    expectedOffset += part.byteSize;
  }
  return parts;
}

async function principal(capability) {
  return authorizeApiCapability(capability);
}

function assertPlatformAccess(principalValue, platform, level = "view") {
  if (!principalHasAccess(principalValue, `publishing.${platform}`, level)) {
    throw new Error(`Your role does not include ${level} access to publishing.${platform}.`);
  }
}

function visibleForPrincipal(principalValue, rows) {
  return rows.filter((row) => principalHasAccess(principalValue, `publishing.${row.platform}`, "view"));
}

async function visibleWorkspacePublishing(principalValue) {
  const snapshot = await publishingWorkspaceSnapshot(principalValue.workspaceId);
  const accounts = visibleForPrincipal(principalValue, snapshot.accounts);
  const accountIds = new Set(accounts.map((account) => account.id));
  const uploads = snapshot.uploads.filter((upload) => accountIds.has(upload.accountId));
  return { accounts, accountIds, uploads, snapshot };
}

async function centralAccountForPrincipal(principalValue, accountId, level = "view") {
  const [account] = await centralAccountsForPrincipal(principalValue, [accountId], level);
  return account;
}

async function centralAccountsForPrincipal(principalValue, accountIds, level = "view") {
  const requestedIds = [...new Set((Array.isArray(accountIds) ? accountIds : []).map(String))];
  const accountsById = new Map((await listCentralAccounts(principalValue.workspaceId)).map((item) => [item.id, item]));
  return requestedIds.map((accountId) => {
    const account = accountsById.get(accountId);
    if (!account) throw new Error("Account was not found.");
    assertPlatformAccess(principalValue, account.platform, level);
    return account;
  });
}

async function centralUploadsForPrincipal(principalValue, uploadIds, level = "view") {
  const requestedIds = [...new Set((Array.isArray(uploadIds) ? uploadIds : []).map(String))];
  const uploadsById = new Map((await listCentralUploads(principalValue.workspaceId)).map((item) => [item.id, item]));
  return requestedIds.map((uploadId) => {
    const upload = uploadsById.get(uploadId);
    if (!upload) throw new Error("Post was not found.");
    assertPlatformAccess(principalValue, upload.platform, level);
    return upload;
  });
}

async function centralUploadForPrincipal(principalValue, uploadId, level = "view") {
  const upload = (await listCentralUploads(principalValue.workspaceId)).find((item) => item.id === uploadId);
  if (!upload) throw new Error("Post was not found.");
  assertPlatformAccess(principalValue, upload.platform, level);
  return upload;
}

async function finishStagedMedia(principalValue, stagedUploadId, previewInput = null) {
  let stage = await getCentralStagedUpload(principalValue.workspaceId, stagedUploadId);
  if (stage.offset !== stage.size) throw new Error("The media upload has not finished yet.");
  const previewArtifact = previewInput ? await storePublishingPreviewInput({
    workspaceId: principalValue.workspaceId,
    fileName: stage.fileName,
    originalName: stage.originalName,
    preview: previewInput,
  }).then((result) => result?.artifact || null).catch((error) => {
    console.warn("Publishing preview generation failed", error instanceof Error ? error.message : error);
    return null;
  }) : null;
  if (stage.artifactManifest) {
    return {
      originalName: stage.originalName,
      fileName: stage.fileName,
      mimeType: stage.mimeType,
      size: stage.size,
      extension: path.extname(stage.originalName),
      url: "",
      artifact: stage.artifactManifest,
      previewArtifact,
    };
  }
  if (stage.uploadStrategy === "signed_parts" || stage.artifactParts?.length) {
    const artifact = await finalizeSupabaseJobArtifact({
      workspaceId: principalValue.workspaceId,
      fileName: stage.fileName,
      originalName: stage.originalName,
      mimeType: stage.mimeType,
      byteSize: stage.size,
      parts: stage.artifactParts,
    });
    stage = await finalizeCentralStagedUpload(principalValue, stagedUploadId, artifact);
    return {
      originalName: stage.originalName,
      fileName: stage.fileName,
      mimeType: stage.mimeType,
      size: stage.size,
      extension: path.extname(stage.originalName),
      url: "",
      artifact: stage.artifactManifest,
      previewArtifact,
    };
  }
  throw new Error("The media upload has no stored parts. Please upload the file again.");
}

// Reddit accounts connected through OAuth publish from the server, not the
// Companion. Start due posts once the response is sent; the scheduled
// reddit-publisher function covers future times and any missed run.
function publishDueRedditPosts(workspaceId, rows) {
  if (!(Array.isArray(rows) ? rows : [rows]).some((row) => row?.platform === "reddit")) return;
  after(async () => {
    try {
      await runDueRedditApiJobs({ workspaceId });
    } catch (error) {
      console.error("Reddit API publishing run failed", { workspaceId, message: error instanceof Error ? error.message : "Unknown error" });
    }
  });
}

async function createPosts(principalValue, input) {
  const destinations = Array.isArray(input.destinations) ? input.destinations : [];
  if (!destinations.length) throw new Error("Choose at least one workspace account.");
  const keys = destinations.map(destination => `${destination.accountId}::${destination.linkedinPageId || "personal"}`);
  if (new Set(keys).size !== keys.length) throw new Error("Each publishing destination can be selected only once.");
  const accounts = await centralAccountsForPrincipal(principalValue, destinations.map((destination) => destination.accountId), "operate");
  const accountsById = new Map(accounts.map(account => [account.id, account]));
  const uploads = await createCentralUploads(principalValue, destinations.map((destination) => {
    const account = accountsById.get(destination.accountId);
    if (!account) throw new Error("The selected publishing account is no longer available.");
    const linkedinTarget = destination.linkedinPageId
      ? account.platform === "linkedin"
        ? account.linkedinManagedPages?.find(page => page.id === destination.linkedinPageId)
        : null
      : undefined;
    if (destination.linkedinPageId && !linkedinTarget) {
      throw new Error("The selected managed LinkedIn Page is no longer available. Reconnect LinkedIn and choose it again.");
    }
    return {
      ...input,
      accountId: destination.accountId,
      linkedinTarget,
      caption: destination.caption ?? destination.description ?? input.description ?? input.caption,
      scheduledAt: destination.scheduledAt || null,
      scheduleId: destination.scheduleId || null,
    };
  }));
  publishDueRedditPosts(principalValue.workspaceId, uploads);
  return uploads;
}

async function validatedPublishingDestinations(principalValue, destinations, level = "operate") {
  const requested = Array.isArray(destinations) ? destinations : [];
  const accounts = await centralAccountsForPrincipal(principalValue, requested.map(destination => destination.accountId), level);
  const accountsById = new Map(accounts.map(account => [account.id, account]));
  const keys = requested.map(destination => `${destination.accountId}::${destination.linkedinPageId || "personal"}`);
  if (new Set(keys).size !== keys.length) throw new Error("Each publishing destination can be selected only once.");
  return requested.map(destination => {
    const account = accountsById.get(destination.accountId);
    if (!account) throw new Error("The selected publishing account is no longer available.");
    const linkedinTarget = destination.linkedinPageId
      ? account.platform === "linkedin"
        ? account.linkedinManagedPages?.find(page => page.id === destination.linkedinPageId)
        : null
      : undefined;
    if (destination.linkedinPageId && !linkedinTarget) {
      throw new Error("The selected managed LinkedIn Page is no longer available. Reconnect LinkedIn and choose it again.");
    }
    return { ...destination, linkedinTarget };
  });
}

async function requestJson(request) {
  return request.json().catch(() => ({}));
}

export async function GET(request, context) {
  try {
    const parts = await segments(context);
    if (parts[0] === "companion" && parts[1] === "jobs") {
      return Response.json({ message: "Companion job transport moved to Supabase RPC." }, { status: 410 });
    }
    if (parts[0] === "media" && parts[1]) {
      const webPrincipal = await principal("publishing.view");
      const workspaceId = webPrincipal.workspaceId;
      const media = await publishingWorkspaceMediaRecord(workspaceId, parts[1]);
      if (!media) return Response.json({ message: "Publishing media was not found." }, { status: 404 });
      if (media.platform) assertPlatformAccess(webPrincipal, media.platform, "view");
      else {
        const visibleAccountIds = new Set(visibleForPrincipal(webPrincipal, await listCentralAccounts(workspaceId)).map((account) => account.id));
        if (!media.selectedAccountIds.some((accountId) => visibleAccountIds.has(accountId))) {
          throw new Error("Your role does not include access to this publishing media.");
        }
      }
      return publishingMediaResponse(request, { ...media, workspaceId });
    }
    const user = await principal("publishing.view");
    const query = new URL(request.url).searchParams;
    if (parts[0] === "workspace-snapshot") {
      const snapshot = await publishingWorkspaceSnapshot(user.workspaceId);
      const accounts = visibleForPrincipal(user, snapshot.accounts);
      const accountIds = new Set(accounts.map((account) => account.id));
      const uploads = snapshot.uploads.filter((upload) => accountIds.has(upload.accountId));
      const uploadIds = new Set(uploads.map((upload) => upload.id));
      const jobs = snapshot.jobs.filter((job) => accountIds.has(job.accountId));
      return Response.json({
        health: {
          ok: true,
          automationReady: true,
          automationRunning: jobs.some((job) => ["opening_platform", "uploading", "publishing"].includes(job.state)),
          companion: snapshot.companion,
          minimumCompanionVersion: minimumCompanionVersion(),
          transport: "central",
        },
        uploads,
        submissions: snapshot.submissions.filter((submission) => submission.selectedAccountIds.some((accountId) => accountIds.has(accountId))),
        accounts,
        schedules: snapshot.schedules,
        users: [],
        activityLogs: snapshot.activityLogs.filter((entry) => entry.uploadId && uploadIds.has(entry.uploadId)),
      });
    }
    if (parts[0] === "health") {
      const dashboard = await publishingDashboard(user.workspaceId);
      const companionValue = dashboard.companion;
      return Response.json({
        ok: true,
        automationReady: true,
        automationRunning: dashboard.jobs.some((job) => ["opening_platform", "uploading", "publishing"].includes(job.state)),
        companion: companionValue,
        minimumCompanionVersion: minimumCompanionVersion(),
        transport: "central",
      });
    }
    if (parts[0] === "auth" && parts[1] === "me") return Response.json(publishingUserFromPrincipal(user));
    if (parts[0] === "accounts") return Response.json(visibleForPrincipal(user, await listCentralAccounts(user.workspaceId, query.get("platform") || undefined)));
    if (parts[0] === "uploads") return Response.json((await visibleWorkspacePublishing(user)).uploads);
    if (parts[0] === "dashboard") {
      const [dashboard, visible] = await Promise.all([publishingDashboard(user.workspaceId), visibleWorkspacePublishing(user)]);
      const uploadIds = new Set(visible.uploads.map((upload) => upload.id));
      const jobs = dashboard.jobs.filter((job) => visible.accountIds.has(job.accountId));
      const recentActivity = dashboard.recentActivity.filter((entry) => entry.uploadId && uploadIds.has(entry.uploadId));
      return Response.json({
        ...dashboard,
        totals: {
          accounts: visible.accounts.length,
          queued: visible.uploads.filter((upload) => upload.status === "queued").length,
          processing: visible.uploads.filter((upload) => upload.status === "processing").length,
          posted: visible.uploads.filter((upload) => upload.status === "posted").length,
          failed: visible.uploads.filter((upload) => upload.status === "failed").length,
        },
        jobs,
        recentActivity,
      });
    }
    if (parts[0] === "submissions") {
      const { accountIds: visibleAccountIds, snapshot } = await visibleWorkspacePublishing(user);
      return Response.json(snapshot.submissions.filter((submission) => submission.selectedAccountIds.some((accountId) => visibleAccountIds.has(accountId))));
    }
    if (parts[0] === "schedules") return Response.json(await listCentralSchedules(user.workspaceId));
    if (parts[0] === "social-media-schedules") return Response.json([]);
    if (parts[0] === "activity-logs") {
      const [dashboard, visible] = await Promise.all([publishingDashboard(user.workspaceId), visibleWorkspacePublishing(user)]);
      const uploadIds = new Set(visible.uploads.map((upload) => upload.id));
      return Response.json(dashboard.recentActivity.filter((entry) => entry.uploadId && uploadIds.has(entry.uploadId)));
    }
    if (parts[0] === "companion") return Response.json({ companion: await getCentralCompanion(user.workspaceId) });
    if (parts[0] === "automation" && parts[1] === "input") {
      const uploads = visibleForPrincipal(user, await listCentralUploads(user.workspaceId));
      return Response.json({ workspaceId: user.workspaceId, posts: uploads.filter((item) => item.status === "queued") });
    }
    return Response.json({ message: "Publishing endpoint was not found." }, { status: 404 });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request, context) {
  try {
    const parts = await segments(context);
    if (parts[0] === "companion" && parts[1] === "heartbeat") {
      return Response.json({ message: "Companion heartbeat transport moved to Supabase RPC." }, { status: 410 });
    }
    if (parts[0] === "companion" && parts[1] === "jobs" && parts[3] === "status") {
      return Response.json({ message: "Companion job transport moved to Supabase RPC." }, { status: 410 });
    }
    if (parts[0] === "companion" && parts[1] === "pair" && parts[2] === "redeem") {
      return Response.json({ message: "Companion pairing redemption moved to Supabase RPC." }, { status: 410 });
    }
    if (parts[0] === "companion" && parts[1] === "pair") {
      const user = await principal("publishing.accounts.configure");
      return Response.json(await createCompanionPairing(user, await requestJson(request)));
    }
    if (parts[0] === "staged-uploads" && parts[1] && parts[2] === "chunks") {
      const user = await principal("publishing.content.create");
      const stage = await getCentralStagedUpload(user.workspaceId, parts[1]);
      const offset = Number(request.headers.get("x-upload-offset"));
      if (!Number.isInteger(offset) || offset !== stage.offset) throw new Error("The media upload offset does not match the upload session.");
      const bytes = Buffer.from(await request.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_CHUNK_BYTES || offset + bytes.length > stage.size) {
        throw new Error("The media upload chunk is invalid.");
      }
      const artifactPart = await storeSupabaseJobArtifactPart(bytes, {
          workspaceId: user.workspaceId,
          fileName: stage.fileName,
          mimeType: stage.mimeType,
          index: Math.floor(offset / stage.chunkSize),
          offset,
        });
      return Response.json(await advanceCentralStagedUpload(user, stage.id, offset + bytes.length, artifactPart));
    }
    if (parts[0] === "staged-uploads" && parts[1] && parts[2] === "parts" && parts[3] === "authorize") {
      const user = await principal("publishing.content.create");
      const stage = await getCentralStagedUpload(user.workspaceId, parts[1]);
      if (stage.uploadStrategy !== "signed_parts") throw new Error("This upload session does not support direct media parts.");
      const input = await requestJson(request);
      const requested = requestedArtifactParts(stage, input);
      // Companion UI builds released before batched authorization request the
      // next few parts concurrently. Keep that safe look-ahead compatible while
      // the committed upload offset remains strictly contiguous.
      if (requested[0].offset < stage.offset
        || requested.at(-1).offset >= stage.offset + (8 * stage.chunkSize)) {
        throw new Error("The direct media batch does not match the upload session.");
      }
      const authorized = await authorizeSupabaseJobArtifactPartUploads(requested.map((part) => ({
        workspaceId: user.workspaceId,
        fileName: stage.fileName,
        mimeType: stage.mimeType,
        ...part,
      })));
      return Response.json(Array.isArray(input.parts) ? authorized : authorized[0]);
    }
    if (parts[0] === "staged-uploads" && parts[1] && parts[2] === "parts" && parts[3] === "complete") {
      const user = await principal("publishing.content.create");
      const stage = await getCentralStagedUpload(user.workspaceId, parts[1]);
      if (stage.uploadStrategy !== "signed_parts") throw new Error("This upload session does not support direct media parts.");
      const input = await requestJson(request);
      const requested = requestedArtifactParts(stage, input);
      const recordedParts = new Map((Array.isArray(stage.artifactParts) ? stage.artifactParts : []).map((part) => [part.index, part]));
      const pending = [];
      for (const part of requested) {
        if (part.offset + part.byteSize <= stage.offset) {
          const recorded = recordedParts.get(part.index);
          if (!recorded || recorded.offset !== part.offset || recorded.byteSize !== part.byteSize) {
            throw new Error("The completed media batch conflicts with the upload session.");
          }
        } else {
          if (part.offset < stage.offset) throw new Error("The completed media batch overlaps the upload session.");
          pending.push(part);
        }
      }
      if (!pending.length) return Response.json({ id: stage.id, offset: stage.offset, chunkSize: stage.chunkSize });
      if (pending[0].offset !== stage.offset) throw new Error("The completed media batch does not match the upload session.");
      const verified = await verifySupabaseJobArtifactPartUploads(pending.map((part) => ({
        workspaceId: user.workspaceId,
        fileName: stage.fileName,
        ...part,
      })));
      return Response.json(await advanceCentralStagedUploadParts(user, stage.id, verified));
    }
    if (parts[0] === "staged-uploads" && parts[1] && parts[2] === "finalize") {
      const user = await principal("publishing.content.create");
      const media = await finishStagedMedia(user, parts[1]);
      return Response.json({ id: parts[1], finalized: true, size: media.size });
    }
    const body = await requestJson(request);
    if (parts[0] === "staged-uploads") {
      const user = await principal("publishing.content.create");
      return Response.json(await createCentralStagedUpload(user, body), { status: 201 });
    }
    if (parts[0] === "posts" && parts[1] === "unified" && parts[2] === "text") {
      // Direct posts enter the executable queue immediately. Keep that path
      // limited to a Publishing Manager; uploaders use submissions instead.
      const user = await principal("publishing.execute");
      return Response.json(await createPosts(user, { ...body, postFormat: "text", description: body.description || "" }), { status: 201 });
    }
    if (parts[0] === "posts" && parts[1] === "unified" && parts[2] === "staged") {
      const user = await principal("publishing.execute");
      const media = await finishStagedMedia(user, body.stagedUploadId, body.preview);
      return Response.json(await createPosts(user, {
        ...body,
        ...media,
        sourceSubmissionId: body.stagedUploadId,
        description: body.description || "",
      }), { status: 201 });
    }
    if (parts[0] === "submissions" && parts[1] === "text") {
      const user = await principal("publishing.content.create");
      await assertPrincipalCapability(user, "publishing.destinations.select");
      await assertPrincipalCapability(user, "publishing.submissions.create");
      const selectedDestinations = await validatedPublishingDestinations(
        user,
        body.selectedDestinations || (body.selectedAccountIds || []).map(accountId => ({ accountId })),
      );
      return Response.json(await createCentralSubmission(user, {
        ...body,
        selectedAccountIds: [...new Set(selectedDestinations.map(destination => destination.accountId))],
        selectedDestinations: selectedDestinations.map(({ linkedinTarget: _target, ...destination }) => destination),
        postFormat: "text",
        description: body.description || "",
      }), { status: 201 });
    }
    if (parts[0] === "submissions" && parts[1] === "staged") {
      const user = await principal("publishing.content.create");
      await assertPrincipalCapability(user, "publishing.destinations.select");
      await assertPrincipalCapability(user, "publishing.submissions.create");
      const selectedDestinations = await validatedPublishingDestinations(
        user,
        body.selectedDestinations || (body.selectedAccountIds || []).map(accountId => ({ accountId })),
      );
      const media = await finishStagedMedia(user, body.stagedUploadId, body.preview);
      return Response.json(await createCentralSubmission(user, {
        ...body,
        ...media,
        selectedAccountIds: [...new Set(selectedDestinations.map(destination => destination.accountId))],
        selectedDestinations: selectedDestinations.map(({ linkedinTarget: _target, ...destination }) => destination),
        description: body.description || "",
      }), { status: 201 });
    }
    if (parts[0] === "submissions" && parts[2] === "schedule") {
      const user = await principal("publishing.schedule.manage");
      const destinations = await validatedPublishingDestinations(user, body.destinations || []);
      const scheduled = await scheduleCentralSubmission(user, parts[1], destinations);
      publishDueRedditPosts(user.workspaceId, scheduled.uploads);
      return Response.json(scheduled, { status: 201 });
    }
    if (parts[0] === "platforms" && parts[2] === "accounts") {
      const user = await principal("publishing.accounts.configure");
      assertPlatformAccess(user, parts[1], "configure");
      return Response.json(await createCentralAccount(user, parts[1], body), { status: 201 });
    }
    if (parts[0] === "schedules") {
      const user = await principal("publishing.schedule.manage");
      return Response.json(await createCentralSchedule(user, body), { status: 201 });
    }
    if (parts[0] === "automation" && parts[1] === "consent") {
      await principal("publishing.execute");
      return Response.json({ granted: true, message: "Publishing jobs are authorized for the workspace Companion." });
    }
    if (parts[0] === "publishing-safety" && parts[1] === "assess") {
      const user = await principal("publishing.schedule.manage");
      await centralAccountsForPrincipal(user, (body.destinations || []).map((destination) => destination.accountId), "operate");
      return Response.json({ allowed: true, issues: [], assessments: [] });
    }
    if (parts[0] === "automation" && parts[1] === "run") {
      const user = await principal("publishing.execute");
      const requestedUploadIds = [...new Set((Array.isArray(body.uploadIds) ? body.uploadIds : []).map(String).filter(Boolean))];
      // Direct creation already queues and synchronizes these jobs atomically.
      // Older open tabs still call this route afterward, so acknowledge them
      // without re-locking and re-synchronizing the complete workspace.
      if (requestedUploadIds.length) {
        return Response.json({ message: "Posts are queued for the workspace Companion.", uploadIds: requestedUploadIds });
      }
      await centralUploadsForPrincipal(user, body.uploadIds || [], "operate");
      const jobs = await queueCentralUploads(user, body.uploadIds);
      publishDueRedditPosts(user.workspaceId, jobs);
      return Response.json({ message: "Posts are queued for the workspace Companion.", uploadIds: jobs.map((job) => job.uploadId) });
    }
    if (parts[0] === "automation" && parts[1] === "stop") return Response.json({ stopped: false, message: "Queued work remains safe until the workspace Companion is online." });
    if (parts[0] === "accounts" && parts[2] === "manual-login") {
      const user = await principal("publishing.accounts.configure");
      await centralAccountForPrincipal(user, parts[1], "configure");
      return Response.json({ started: false, message: "Open the paired Workspace Companion on the manager device to sign in.", requiresCompanion: true });
    }
    return Response.json({ message: "Publishing endpoint was not found." }, { status: 404 });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request, context) {
  try {
    const parts = await segments(context);
    if (parts[0] === "companion" && parts[1] === "jobs" && parts[3] === "status") {
      return Response.json({ message: "Companion job transport moved to Supabase RPC." }, { status: 410 });
    }
    const body = await requestJson(request);
    if (parts[0] === "accounts" && parts[1]) {
      const user = await principal("publishing.accounts.configure");
      await centralAccountForPrincipal(user, parts[1], "configure");
      return Response.json(await updateCentralAccount(user, parts[1], body));
    }
    if (parts[0] === "uploads" && parts[2] === "status") {
      const user = await principal("publishing.execute");
      await centralUploadForPrincipal(user, parts[1], "operate");
      return Response.json(await updateCentralUploadStatus(user, parts[1], body.status, body.failureReason));
    }
    if (parts[0] === "uploads" && parts[1]) {
      const scheduleOnly = Object.keys(body).length > 0 && Object.keys(body).every((key) => key === "scheduledAt" || key === "scheduleId");
      // Content uploaded for handoff is immutable once a Scheduler turns it
      // into a queued post. Only a Publishing Manager can change queued copy.
      const user = await principal(scheduleOnly ? "publishing.schedule.manage" : "publishing.execute");
      await centralUploadForPrincipal(user, parts[1], "operate");
      const updated = await updateCentralUpload(user, parts[1], body);
      publishDueRedditPosts(user.workspaceId, updated);
      return Response.json(updated);
    }
    if (parts[0] === "schedules" && parts[1]) {
      const user = await principal("publishing.schedule.manage");
      return Response.json(await updateCentralSchedule(user, Number(parts[1]), body));
    }
    return Response.json({ message: "Publishing endpoint was not found." }, { status: 404 });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request, context) {
  try {
    const parts = await segments(context);
    if (parts[0] === "companion") {
      const user = await principal("publishing.accounts.configure");
      return Response.json(await removeCentralCompanion(user));
    }
    if (parts[0] === "staged-uploads" && parts[1]) {
      const user = await principal("publishing.content.create");
      const stage = await getCentralStagedUpload(user.workspaceId, parts[1]);
      await deleteCentralStagedUpload(user, parts[1]);
      await Promise.all([
        (stage.uploadStrategy === "signed_parts"
          ? deleteSupabaseStagedArtifactParts({ workspaceId: stage.workspaceId, fileName: stage.fileName, partCount: Math.ceil(stage.size / stage.chunkSize) })
          : deleteSupabaseJobArtifactParts(stage.artifactParts)).catch(() => undefined),
      ]);
      return new Response(null, { status: 204 });
    }
    if (parts[0] === "accounts" && parts[1]) {
      const user = await principal("publishing.accounts.configure");
      await centralAccountForPrincipal(user, parts[1], "configure");
      return Response.json(await deleteCentralAccount(user, parts[1]));
    }
    if (parts[0] === "uploads" && parts[1]) {
      const user = await principal("publishing.content.edit");
      await centralUploadForPrincipal(user, parts[1], "operate");
      return Response.json(await deleteCentralUpload(user, parts[1]));
    }
    if (parts[0] === "schedules" && parts[1]) {
      const user = await principal("publishing.schedule.manage");
      return Response.json(await deleteCentralSchedule(user, Number(parts[1])));
    }
    return Response.json({ message: "Publishing endpoint was not found." }, { status: 404 });
  } catch (error) {
    return fail(error);
  }
}
