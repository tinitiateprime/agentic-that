import { promises as fs } from "node:fs";
import path from "node:path";
import { accessErrorResponse, authorizeApiCapabilityForRequest, principalHasAccess } from "@platform/server/access-control";
import {
  advanceCentralStagedUpload,
  authenticateCentralCompanion,
  centralMediaFileName,
  claimCentralJobs,
  createCentralAccount,
  createCentralSchedule,
  createCentralStagedUpload,
  createCentralSubmission,
  createCentralUpload,
  createCompanionPairing,
  deleteCentralAccount,
  deleteCentralSchedule,
  deleteCentralStagedUpload,
  deleteCentralUpload,
  getCentralCompanion,
  getCentralStagedUpload,
  heartbeatCentralCompanion,
  listCentralAccounts,
  listCentralSchedules,
  listCentralSubmissions,
  listCentralUploads,
  publishingDashboard,
  publishingUserFromPrincipal,
  queueCentralUploads,
  removeCentralCompanion,
  scheduleCentralSubmission,
  updateCentralAccount,
  updateCentralJob,
  updateCentralSchedule,
  updateCentralUpload,
  updateCentralUploadStatus,
  consumeCentralStagedUpload,
} from "@platform/server/publishing-central-store";
import { deletePublishingMedia, readPublishingMedia, storePublishingMedia } from "../../../../services/publishing/queue-runner/server/media-storage.ts";
import { publishingUploadDirectory } from "../../../../services/publishing/queue-runner/server/runtime-paths.ts";

export const runtime = "nodejs";

const MAX_CHUNK_BYTES = 2 * 1024 * 1024;
const localStageRoot = path.join(publishingUploadDirectory(), ".central-staged");

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

function companionToken(request) {
  return request.headers.get("x-agenticthat-companion-token") || "";
}

async function companion(request) {
  const token = companionToken(request);
  if (!token) throw new Error("Companion authentication is required.");
  return { token, companion: await authenticateCentralCompanion(token) };
}

async function principal(request, capability) {
  return authorizeApiCapabilityForRequest(request, capability, "publishing");
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
  const accounts = visibleForPrincipal(principalValue, await listCentralAccounts(principalValue.workspaceId));
  const accountIds = new Set(accounts.map((account) => account.id));
  const uploads = (await listCentralUploads(principalValue.workspaceId)).filter((upload) => accountIds.has(upload.accountId));
  return { accounts, accountIds, uploads };
}

async function centralAccountForPrincipal(principalValue, accountId, level = "view") {
  const account = (await listCentralAccounts(principalValue.workspaceId)).find((item) => item.id === accountId);
  if (!account) throw new Error("Account was not found.");
  assertPlatformAccess(principalValue, account.platform, level);
  return account;
}

async function centralUploadForPrincipal(principalValue, uploadId, level = "view") {
  const upload = (await listCentralUploads(principalValue.workspaceId)).find((item) => item.id === uploadId);
  if (!upload) throw new Error("Post was not found.");
  assertPlatformAccess(principalValue, upload.platform, level);
  return upload;
}

function stagingUsesBlobs() {
  return process.env.DATA_STORE === "netlify-blobs" || process.env.NETLIFY === "true" || Boolean(process.env.NETLIFY_BLOBS_CONTEXT);
}

function stageChunkKey(stage, offset) {
  return `workspaces/${encodeURIComponent(stage.workspaceId)}/staged/${encodeURIComponent(stage.id)}/${offset}`;
}

function localStagePath(stage) {
  return path.join(localStageRoot, encodeURIComponent(stage.workspaceId), encodeURIComponent(stage.id));
}

async function putStageChunk(stage, offset, bytes) {
  if (stagingUsesBlobs()) {
    const { getStore } = await import("@netlify/blobs");
    await getStore("agentic-that-publishing-staging").set(stageChunkKey(stage, offset), bytes, { metadata: { workspaceId: stage.workspaceId } });
    return;
  }
  const file = localStagePath(stage);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const handle = await fs.open(file, "r+").catch(() => fs.open(file, "w+", 0o600));
  try {
    await handle.write(bytes, 0, bytes.length, offset);
  } finally {
    await handle.close();
  }
}

async function readStageBytes(stage) {
  if (!stagingUsesBlobs()) return fs.readFile(localStagePath(stage));
  const { getStore } = await import("@netlify/blobs");
  const store = getStore("agentic-that-publishing-staging");
  const buffers = [];
  for (let offset = 0; offset < stage.size; offset += stage.chunkSize) {
    const chunk = await store.get(stageChunkKey(stage, offset), { type: "arrayBuffer" });
    if (!chunk) throw new Error("Part of the media upload is missing. Please upload the file again.");
    buffers.push(Buffer.from(chunk));
  }
  return Buffer.concat(buffers);
}

async function removeStageBytes(stage) {
  if (!stagingUsesBlobs()) {
    await fs.unlink(localStagePath(stage)).catch(() => undefined);
    return;
  }
  const { getStore } = await import("@netlify/blobs");
  const store = getStore("agentic-that-publishing-staging");
  await Promise.all(Array.from({ length: Math.ceil(stage.size / stage.chunkSize) }, (_, index) => store.delete(stageChunkKey(stage, index * stage.chunkSize)).catch(() => undefined)));
}

async function finishStagedMedia(principalValue, stagedUploadId) {
  const stage = await getCentralStagedUpload(principalValue.workspaceId, stagedUploadId);
  if (stage.offset !== stage.size) throw new Error("The media upload has not finished yet.");
  const bytes = await readStageBytes(stage);
  if (bytes.length !== stage.size) throw new Error("The media upload size is invalid. Please upload the file again.");
  const filePath = path.join(publishingUploadDirectory(), stage.fileName);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, bytes, { mode: 0o600 });
  await fs.rename(temporary, filePath);
  await storePublishingMedia(stage.fileName, principalValue.workspaceId, stage.mimeType);
  await consumeCentralStagedUpload(principalValue, stagedUploadId);
  await removeStageBytes(stage);
  return {
    originalName: stage.originalName,
    fileName: stage.fileName,
    mimeType: stage.mimeType,
    size: stage.size,
    extension: path.extname(stage.originalName),
    url: `/api/central-publishing/media/${encodeURIComponent(stage.fileName)}`,
  };
}

async function createPosts(principalValue, input) {
  const destinations = Array.isArray(input.destinations) ? input.destinations : [];
  if (!destinations.length) throw new Error("Choose at least one workspace account.");
  await Promise.all(destinations.map((destination) => centralAccountForPrincipal(principalValue, destination.accountId, "operate")));
  return Promise.all(destinations.map((destination) => createCentralUpload(principalValue, {
    ...input,
    accountId: destination.accountId,
    caption: destination.caption ?? input.description ?? input.caption,
    scheduledAt: destination.scheduledAt || null,
    scheduleId: destination.scheduleId || null,
  })));
}

async function requestJson(request) {
  return request.json().catch(() => ({}));
}

export async function GET(request, context) {
  try {
    const parts = await segments(context);
    if (parts[0] === "companion" && parts[1] === "jobs") {
      const authenticated = await companion(request);
      const limit = Number(new URL(request.url).searchParams.get("limit") || 1);
      return Response.json({ jobs: await claimCentralJobs(authenticated.token, limit) });
    }
    if (parts[0] === "media" && parts[1]) {
      let workspaceId;
      let webPrincipal;
      const token = companionToken(request);
      if (token) workspaceId = (await companion(request)).companion.workspaceId;
      else {
        webPrincipal = await principal(request, "publishing.view");
        workspaceId = webPrincipal.workspaceId;
      }
      const upload = (await listCentralUploads(workspaceId)).find((item) => item.fileName === parts[1]);
      const submission = upload ? null : (await listCentralSubmissions(workspaceId)).find((item) => item.fileName === parts[1]);
      if (!upload && !submission) return Response.json({ message: "Publishing media was not found." }, { status: 404 });
      if (!token && upload) {
        assertPlatformAccess(webPrincipal, upload.platform, "view");
      }
      if (!token && submission) {
        const visibleAccountIds = new Set(visibleForPrincipal(webPrincipal, await listCentralAccounts(workspaceId)).map((account) => account.id));
        if (!submission.selectedAccountIds.some((accountId) => visibleAccountIds.has(accountId))) {
          throw new Error("Your role does not include access to this publishing media.");
        }
      }
      const bytes = await readPublishingMedia(parts[1], workspaceId);
      return new Response(bytes, { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, max-age=300" } });
    }
    const user = await principal(request, "publishing.view");
    const query = new URL(request.url).searchParams;
    if (parts[0] === "health") {
      const dashboard = await publishingDashboard(user.workspaceId);
      const companionValue = dashboard.companion;
      return Response.json({
        ok: true,
        automationReady: true,
        automationRunning: dashboard.jobs.some((job) => ["opening_platform", "uploading", "publishing"].includes(job.state)),
        companion: companionValue,
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
      const { accountIds: visibleAccountIds } = await visibleWorkspacePublishing(user);
      return Response.json((await listCentralSubmissions(user.workspaceId)).filter((submission) => submission.selectedAccountIds.some((accountId) => visibleAccountIds.has(accountId))));
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
      const token = companionToken(request);
      const body = await requestJson(request);
      return Response.json({ companion: await heartbeatCentralCompanion(token, body) });
    }
    if (parts[0] === "companion" && parts[1] === "jobs" && parts[3] === "status") {
      const token = companionToken(request);
      return Response.json(await updateCentralJob(token, parts[2], await requestJson(request)));
    }
    if (parts[0] === "companion" && parts[1] === "pair") {
      const user = await principal(request, "publishing.accounts.configure");
      return Response.json(await createCompanionPairing(user, await requestJson(request)));
    }
    if (parts[0] === "staged-uploads" && parts[1] && parts[2] === "chunks") {
      const user = await principal(request, "publishing.content.create");
      const stage = await getCentralStagedUpload(user.workspaceId, parts[1]);
      const offset = Number(request.headers.get("x-upload-offset"));
      if (!Number.isInteger(offset) || offset !== stage.offset) throw new Error("The media upload offset does not match the upload session.");
      const bytes = Buffer.from(await request.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_CHUNK_BYTES || offset + bytes.length > stage.size) {
        throw new Error("The media upload chunk is invalid.");
      }
      await putStageChunk(stage, offset, bytes);
      return Response.json(await advanceCentralStagedUpload(user, stage.id, offset + bytes.length));
    }
    const body = await requestJson(request);
    if (parts[0] === "staged-uploads") {
      const user = await principal(request, "publishing.content.create");
      return Response.json(await createCentralStagedUpload(user, body), { status: 201 });
    }
    if (parts[0] === "posts" && parts[1] === "unified" && parts[2] === "text") {
      // Direct posts enter the executable queue immediately. Keep that path
      // limited to a Publishing Manager; uploaders use submissions instead.
      const user = await principal(request, "publishing.execute");
      return Response.json(await createPosts(user, { ...body, postFormat: "text", description: body.description || "" }), { status: 201 });
    }
    if (parts[0] === "posts" && parts[1] === "unified" && parts[2] === "staged") {
      const user = await principal(request, "publishing.execute");
      const media = await finishStagedMedia(user, body.stagedUploadId);
      return Response.json(await createPosts(user, { ...body, ...media, description: body.description || "" }), { status: 201 });
    }
    if (parts[0] === "submissions" && parts[1] === "text") {
      const user = await principal(request, "publishing.content.create");
      await Promise.all((body.selectedAccountIds || []).map((accountId) => centralAccountForPrincipal(user, accountId, "operate")));
      return Response.json(await createCentralSubmission(user, { ...body, postFormat: "text", description: body.description || "" }), { status: 201 });
    }
    if (parts[0] === "submissions" && parts[1] === "staged") {
      const user = await principal(request, "publishing.content.create");
      await Promise.all((body.selectedAccountIds || []).map((accountId) => centralAccountForPrincipal(user, accountId, "operate")));
      const media = await finishStagedMedia(user, body.stagedUploadId);
      return Response.json(await createCentralSubmission(user, { ...body, ...media, description: body.description || "" }), { status: 201 });
    }
    if (parts[0] === "submissions" && parts[2] === "schedule") {
      const user = await principal(request, "publishing.schedule.manage");
      await Promise.all((body.destinations || []).map((destination) => centralAccountForPrincipal(user, destination.accountId, "operate")));
      return Response.json(await scheduleCentralSubmission(user, parts[1], body.destinations || []));
    }
    if (parts[0] === "platforms" && parts[2] === "accounts") {
      const user = await principal(request, "publishing.accounts.configure");
      assertPlatformAccess(user, parts[1], "configure");
      return Response.json(await createCentralAccount(user, parts[1], body), { status: 201 });
    }
    if (parts[0] === "schedules") {
      const user = await principal(request, "publishing.schedule.manage");
      return Response.json(await createCentralSchedule(user, body), { status: 201 });
    }
    if (parts[0] === "automation" && parts[1] === "consent") {
      await principal(request, "publishing.execute");
      return Response.json({ granted: true, message: "Publishing jobs are authorized for the workspace Companion." });
    }
    if (parts[0] === "publishing-safety" && parts[1] === "assess") {
      const user = await principal(request, "publishing.schedule.manage");
      await Promise.all((body.destinations || []).map((destination) => centralAccountForPrincipal(user, destination.accountId, "operate")));
      return Response.json({ allowed: true, issues: [], assessments: [] });
    }
    if (parts[0] === "automation" && parts[1] === "run") {
      const user = await principal(request, "publishing.execute");
      await Promise.all((body.uploadIds || []).map((uploadId) => centralUploadForPrincipal(user, uploadId, "operate")));
      const jobs = await queueCentralUploads(user, body.uploadIds);
      return Response.json({ message: "Posts are queued for the workspace Companion.", uploadIds: jobs.map((job) => job.uploadId) });
    }
    if (parts[0] === "automation" && parts[1] === "stop") return Response.json({ stopped: false, message: "Queued work remains safe until the workspace Companion is online." });
    if (parts[0] === "accounts" && parts[2] === "manual-login") {
      const user = await principal(request, "publishing.accounts.configure");
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
      return Response.json(await updateCentralJob(companionToken(request), parts[2], await requestJson(request)));
    }
    const body = await requestJson(request);
    if (parts[0] === "accounts" && parts[1]) {
      const user = await principal(request, "publishing.accounts.configure");
      await centralAccountForPrincipal(user, parts[1], "configure");
      return Response.json(await updateCentralAccount(user, parts[1], body));
    }
    if (parts[0] === "uploads" && parts[2] === "status") {
      const user = await principal(request, "publishing.execute");
      await centralUploadForPrincipal(user, parts[1], "operate");
      return Response.json(await updateCentralUploadStatus(user, parts[1], body.status, body.failureReason));
    }
    if (parts[0] === "uploads" && parts[1]) {
      const scheduleOnly = Object.keys(body).length > 0 && Object.keys(body).every((key) => key === "scheduledAt" || key === "scheduleId");
      const user = await principal(request, scheduleOnly ? "publishing.schedule.manage" : "publishing.content.edit");
      await centralUploadForPrincipal(user, parts[1], "operate");
      return Response.json(await updateCentralUpload(user, parts[1], body));
    }
    if (parts[0] === "schedules" && parts[1]) {
      const user = await principal(request, "publishing.schedule.manage");
      return Response.json(await updateCentralSchedule(user, parts[1], body));
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
      const user = await principal(request, "publishing.accounts.configure");
      return Response.json(await removeCentralCompanion(user));
    }
    if (parts[0] === "staged-uploads" && parts[1]) {
      const user = await principal(request, "publishing.content.create");
      const stage = await getCentralStagedUpload(user.workspaceId, parts[1]);
      await deleteCentralStagedUpload(user, parts[1]);
      await removeStageBytes(stage);
      return new Response(null, { status: 204 });
    }
    if (parts[0] === "accounts" && parts[1]) {
      const user = await principal(request, "publishing.accounts.configure");
      await centralAccountForPrincipal(user, parts[1], "configure");
      return Response.json(await deleteCentralAccount(user, parts[1]));
    }
    if (parts[0] === "uploads" && parts[1]) {
      const user = await principal(request, "publishing.content.edit");
      await centralUploadForPrincipal(user, parts[1], "operate");
      return Response.json(await deleteCentralUpload(user, parts[1]));
    }
    if (parts[0] === "schedules" && parts[1]) {
      const user = await principal(request, "publishing.schedule.manage");
      return Response.json(await deleteCentralSchedule(user, parts[1]));
    }
    return Response.json({ message: "Publishing endpoint was not found." }, { status: 404 });
  } catch (error) {
    return fail(error);
  }
}
