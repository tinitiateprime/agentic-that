import crypto from "node:crypto";
import {
  platformEmailStudioConfiguration,
  platformPublicLink,
  sendPlatformAuthEmail,
} from "./auth-email.js";
import {
  generateWebsiteSpec,
  normalizeWebsiteBusinessProfile,
  WebsiteStudioError,
  websiteStudioModels,
  websiteStudioThemes,
} from "./website-studio-ai.js";
import { getWebsiteStudioSql } from "./website-studio-database.js";
import { resolveWebsiteMedia, websiteImageConfiguration } from "./website-studio-media.js";
import { runWebsiteRenderQa } from "./website-studio-render-qa.js";

const PROJECT_PREFIX = "website_";

function cleanText(value, max = 300) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function requiredText(value, field, max = 300) {
  const result = cleanText(value, max);
  if (!result) throw new WebsiteStudioError(`${field} is required.`, "INVALID_REQUEST", 400);
  return result;
}

function requiredEmail(value) {
  const result = cleanText(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) {
    throw new WebsiteStudioError("Enter a valid client email address.", "INVALID_REQUEST", 400);
  }
  return result;
}

function safeSlug(value) {
  const base = cleanText(value, 120)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 52) || "business";
  return `${base}-${crypto.randomBytes(4).toString("hex")}`;
}

function previewToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function tokenDigest(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function mapProject(row) {
  return {
    id: row.id,
    businessName: row.business_name,
    businessType: row.business_type,
    clientName: row.client_name,
    clientEmail: row.client_email,
    businessProfile: row.business_profile || {},
    siteSpec: row.site_spec || null,
    qaReport: row.qa_report || {},
    status: row.status,
    selectedTheme: row.selected_theme || null,
    publicSlug: row.public_slug,
    generationModel: row.generation_model || null,
    generationAttempts: Number(row.generation_attempts || 0),
    promptTokens: row.prompt_tokens == null ? null : Number(row.prompt_tokens),
    outputTokens: row.output_tokens == null ? null : Number(row.output_tokens),
    emailStatus: row.email_status,
    emailError: row.email_error || null,
    failureMessage: row.failure_message || null,
    previewExpiresAt: row.preview_expires_at,
    generatedAt: row.generated_at,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedUrl: row.status === "published" ? platformPublicLink(`/sites/${encodeURIComponent(row.public_slug)}`) : null,
  };
}

async function audit(sql, actorUserId, targetId, action, after = null) {
  await sql`
    INSERT INTO rbac_audit_events
      (id, actor_user_id, target_type, target_id, action, before_value, after_value)
    VALUES
      (${crypto.randomUUID()}, ${actorUserId || null}, 'ai_website_project', ${targetId}, ${action}, null,
       ${after ? sql.json(after) : null})`;
}

function previewLinks(token) {
  return Object.fromEntries(websiteStudioThemes().map((theme) => [
    theme,
    platformPublicLink(`/site-preview/${encodeURIComponent(token)}/${theme}`),
  ]));
}

function previewEmailHtml({ businessName, clientName, links }) {
  const cards = [
    { key: "editorial", label: "Editorial", copy: "Refined typography, cinematic spacing and an elevated story-led experience.", color: "#172b26", tint: "#f3eee4" },
    { key: "momentum", label: "Momentum", copy: "Confident contrast, modern structure and a direct conversion-focused journey.", color: "#e9f24b", tint: "#17211f" },
    { key: "aura", label: "Aura", copy: "Warm, immersive presentation with polished detail and an approachable premium feel.", color: "#6b3df0", tint: "#f0eafe" },
  ].map((item) => `<tr><td style="padding:0 0 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e7e5;border-radius:15px;background:${item.tint};overflow:hidden"><tr><td style="padding:20px 20px 20px 22px"><div style="font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:${item.key === "momentum" ? "#dbe644" : item.color}">Concept 0${cardsIndex(item.key)}</div><div style="margin-top:6px;font-size:22px;font-weight:800;color:${item.key === "momentum" ? "#fff" : "#16201d"}">${item.label}</div><div style="margin-top:6px;font-size:13px;line-height:20px;color:${item.key === "momentum" ? "#bdc9c4" : "#66716d"}">${item.copy}</div></td><td width="150" align="center" style="padding:20px"><a href="${escapeHtml(links[item.key])}" style="display:inline-block;padding:12px 18px;border-radius:9px;background:${item.color};color:${item.key === "momentum" ? "#17211f" : "#fff"};font-size:13px;font-weight:800;text-decoration:none">Open &amp; choose</a></td></tr></table></td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your website concepts</title></head><body style="margin:0;background:#eff2ef;color:#17211f;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:36px 15px"><table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:640px;max-width:100%;border:1px solid #dde3df;border-radius:20px;background:#fff;overflow:hidden;box-shadow:0 18px 50px rgba(20,40,32,.08)"><tr><td style="padding:24px 34px;border-bottom:1px solid #e8ece9;background:#fbfcfb"><strong style="font-size:20px">AgenticThat</strong><span style="float:right;color:#738079;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase">Website Studio</span></td></tr><tr><td style="padding:40px 38px"><div style="color:#80701a;font-size:11px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase">Three directions. One business.</div><h1 style="margin:10px 0 0;font-size:36px;line-height:42px;letter-spacing:-1.2px">${escapeHtml(clientName)}, your ${escapeHtml(businessName)} concepts are ready.</h1><p style="margin:16px 0 28px;color:#637069;font-size:16px;line-height:25px">Explore each complete website on desktop or mobile. Choose the direction you prefer and it will publish automatically.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${cards}</table><p style="margin:18px 0 0;color:#8a948f;font-size:11px;line-height:18px">These private preview links expire in 30 days. Selecting a concept publishes it immediately.</p></td></tr></table></td></tr></table></body></html>`;
}

function cardsIndex(key) {
  return key === "editorial" ? "1" : key === "momentum" ? "2" : "3";
}

async function sendPreviewEmail(project, token) {
  const links = previewLinks(token);
  const emailStudio = platformEmailStudioConfiguration();
  const text = `Hello ${project.clientName},\n\nYour three ${project.businessName} website concepts are ready. Open each complete preview and select the one you prefer. Your selected design will publish automatically.\n\nEditorial: ${links.editorial}\nMomentum: ${links.momentum}\nAura: ${links.aura}\n\nThese private preview links expire in 30 days.\n\nAgenticThat`;
  const result = await sendPlatformAuthEmail({
    to: project.clientEmail,
    subject: `${project.businessName}: your three website concepts are ready`,
    text,
    html: previewEmailHtml({ businessName: project.businessName, clientName: project.clientName, links }),
    senderId: emailStudio.configured ? emailStudio.defaultSenderId : undefined,
  });
  return { ...result, links };
}

async function expireStaleGenerations(sql) {
  await sql`
    UPDATE ai_website_projects
       SET status = 'failed', failure_message = 'Generation stopped before completion. Start a new automated delivery.', updated_at = now()
     WHERE status = 'generating'
       AND (
         (generation_attempts = 0 AND updated_at < now() - interval '5 minutes')
         OR updated_at < now() - interval '20 minutes'
       )`;
}

export async function websiteStudioSnapshot() {
  const sql = await getWebsiteStudioSql();
  await expireStaleGenerations(sql);
  const rows = await sql`
    SELECT id, business_name, business_type, client_name, client_email, business_profile,
           site_spec, qa_report, status, selected_theme, public_slug, preview_expires_at,
           generation_model, generation_attempts, prompt_tokens, output_tokens,
           email_status, email_error, failure_message, generated_at, published_at,
           created_at, updated_at
      FROM ai_website_projects
     ORDER BY created_at DESC
     LIMIT 100`;
  return {
    configured: Boolean(String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim()),
    model: websiteStudioModels()[0],
    fallbackModels: websiteStudioModels().slice(1),
    imageProvider: websiteImageConfiguration(),
    projects: rows.map(mapProject),
    themes: websiteStudioThemes(),
  };
}

export async function queueAutomatedWebsiteProject(actor, input) {
  const sql = await getWebsiteStudioSql();
  const clientEmail = requiredEmail(input?.clientEmail);
  const profile = normalizeWebsiteBusinessProfile(input?.businessProfile || input);
  if (!String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim()) {
    throw new WebsiteStudioError("Add GEMINI_API_KEY before generating websites.", "AI_NOT_CONFIGURED", 503);
  }
  if (!websiteImageConfiguration().configured && !profile.heroImage) {
    throw new WebsiteStudioError(
      "Add PEXELS_API_KEY before generating websites so every delivery includes professional photography.",
      "WEBSITE_IMAGES_NOT_CONFIGURED",
      503,
    );
  }
  const clientName = cleanText(input?.clientName, 120) || `${profile.businessName} team`;
  const id = `${PROJECT_PREFIX}${crypto.randomUUID()}`;
  const token = previewToken();
  const slug = safeSlug(profile.businessName);

  await expireStaleGenerations(sql);
  const [recentUsage] = await sql`
    SELECT count(*)::int AS count,
           count(*) FILTER (WHERE status = 'generating')::int AS active
      FROM ai_website_projects
     WHERE created_by = ${actor.userId} AND created_at > now() - interval '1 hour'`;
  if (Number(recentUsage?.active || 0) > 0) {
    throw new WebsiteStudioError("Another website generation is already running. Wait for it to finish.", "GENERATION_IN_PROGRESS", 409);
  }
  if (Number(recentUsage?.count || 0) >= 10) {
    throw new WebsiteStudioError("The hourly website generation limit has been reached. Try again later.", "GENERATION_RATE_LIMITED", 429);
  }

  const [created] = await sql`
    INSERT INTO ai_website_projects
      (id, created_by, business_name, business_type, client_name, client_email,
       business_profile, public_slug, preview_token_hash, status)
    VALUES
      (${id}, ${actor.userId}, ${profile.businessName}, ${profile.businessType}, ${clientName},
       ${clientEmail}, ${sql.json(profile)}, ${slug}, ${tokenDigest(token)}, 'generating')
    RETURNING *`;
  await audit(sql, actor.userId, id, "ai_website.generation_started", {
    businessName: profile.businessName,
    businessType: profile.businessType,
    clientEmail,
  });

  return { project: mapProject(created), jobToken: token };
}

export async function failQueuedWebsiteProject(projectIdInput, tokenInput, error) {
  const id = requiredText(projectIdInput, "Project ID", 100);
  const token = requiredText(tokenInput, "Generation token", 200);
  const message = cleanText(error instanceof Error ? error.message : error, 800)
    || "The background generation job could not be started.";
  const sql = await getWebsiteStudioSql();
  const [failed] = await sql`
    UPDATE ai_website_projects
       SET status = 'failed', failure_message = ${message}, updated_at = now()
     WHERE id = ${id}
       AND preview_token_hash = ${tokenDigest(token)}
       AND status = 'generating'
       AND generation_attempts = 0
     RETURNING *`;
  if (failed) await audit(sql, failed.created_by, id, "ai_website.generation_dispatch_failed", { message });
  return failed ? mapProject(failed) : null;
}

export async function executeAutomatedWebsiteProject(projectIdInput, tokenInput) {
  const id = requiredText(projectIdInput, "Project ID", 100);
  const token = requiredText(tokenInput, "Generation token", 200);
  const sql = await getWebsiteStudioSql();
  const [claimed] = await sql`
    UPDATE ai_website_projects
       SET generation_attempts = 1, failure_message = null, updated_at = now()
     WHERE id = ${id}
       AND preview_token_hash = ${tokenDigest(token)}
       AND status = 'generating'
       AND generation_attempts = 0
     RETURNING *`;

  if (!claimed) {
    const [existing] = await sql`
      SELECT * FROM ai_website_projects
       WHERE id = ${id} AND preview_token_hash = ${tokenDigest(token)}
       LIMIT 1`;
    return existing ? { project: mapProject(existing), claimed: false } : null;
  }

  const profile = normalizeWebsiteBusinessProfile(claimed.business_profile || {});
  const actorUserId = claimed.created_by || null;

  try {
    const generated = await generateWebsiteSpec(profile);
    const media = await resolveWebsiteMedia(generated.spec, profile);
    if (!media.hero) {
      throw new WebsiteStudioError(
        "Professional photography is required for next-level sites. Add a free PEXELS_API_KEY in Netlify, then retry this project.",
        "WEBSITE_IMAGES_NOT_CONFIGURED",
        503,
      );
    }
    generated.spec.media = media;
    generated.qa = {
      ...generated.qa,
      checks: [
        ...generated.qa.checks,
        { key: "professional-media", passed: true, message: `Professional ${media.provider} photography is attached to the website.` },
      ],
    };
    const [staged] = await sql`
      UPDATE ai_website_projects
         SET site_spec = ${sql.json(generated.spec)}, qa_report = ${sql.json(generated.qa)},
             generation_model = ${generated.model},
             generation_attempts = ${generated.attempts}, prompt_tokens = ${generated.usage.promptTokens || null},
             output_tokens = ${generated.usage.outputTokens || null},
             failure_message = null, updated_at = now()
       WHERE id = ${id} AND status = 'generating'
       RETURNING *`;
    if (!staged) {
      throw new WebsiteStudioError("Website generation exceeded its allowed processing time.", "GENERATION_EXPIRED", 504);
    }

    const links = previewLinks(token);
    const renderQa = await runWebsiteRenderQa(links);
    if (!renderQa.passed) {
      generated.qa = {
        ...generated.qa,
        passed: false,
        checks: [...generated.qa.checks, ...renderQa.checks],
        renderedAt: renderQa.checkedAt,
      };
      await sql`
        UPDATE ai_website_projects
           SET qa_report = ${sql.json(generated.qa)}, updated_at = now()
         WHERE id = ${id} AND status = 'generating'`;
      const details = renderQa.checks.filter((check) => !check.passed).map((check) => `${check.key}: ${check.message}`);
      throw new WebsiteStudioError("The generated concepts did not pass automated desktop and mobile visual QA.", "RENDER_QA_FAILED", 502, details);
    }
    generated.qa = {
      ...generated.qa,
      passed: true,
      checks: [...generated.qa.checks, ...renderQa.checks],
      renderedAt: renderQa.checkedAt,
    };
    const [ready] = await sql`
      UPDATE ai_website_projects
         SET qa_report = ${sql.json(generated.qa)}, status = 'awaiting_selection', generated_at = now(), updated_at = now()
       WHERE id = ${id} AND status = 'generating'
       RETURNING *`;
    if (!ready) throw new WebsiteStudioError("Website generation exceeded its allowed processing time.", "GENERATION_EXPIRED", 504);
    await audit(sql, actorUserId, id, "ai_website.generated", {
      model: generated.model,
      attempts: generated.attempts,
      qaPassed: generated.qa.passed,
      renderedConcepts: renderQa.checks.length,
    });

    let delivery;
    try {
      delivery = await sendPreviewEmail(mapProject(ready), token);
      await sql`
        UPDATE ai_website_projects
           SET email_status = ${delivery.skipped ? "skipped" : "sent"},
               email_provider_id = ${delivery.messageId || null}, email_error = null, updated_at = now()
         WHERE id = ${id}`;
      await audit(sql, actorUserId, id, "ai_website.previews_delivered", {
        provider: delivery.provider,
        skipped: delivery.skipped,
      });
    } catch (emailError) {
      const message = cleanText(emailError instanceof Error ? emailError.message : "Preview email delivery failed.", 500);
      await sql`
        UPDATE ai_website_projects
           SET email_status = 'failed', email_error = ${message}, updated_at = now()
         WHERE id = ${id}`;
      delivery = { links, error: message, skipped: false };
    }

    const [result] = await sql`SELECT * FROM ai_website_projects WHERE id = ${id}`;
    return { project: mapProject(result), previewLinks: delivery.links, deliveryWarning: delivery.error || null, claimed: true };
  } catch (error) {
    const message = cleanText(error instanceof Error ? error.message : "Website generation failed.", 800);
    const [failed] = await sql`
      UPDATE ai_website_projects
         SET status = 'failed', failure_message = ${message}, generation_attempts = GREATEST(generation_attempts, ${Math.max(1, Number(error?.attempts || 1))}),
             updated_at = now()
       WHERE id = ${id} AND status IN ('generating', 'awaiting_selection')
       RETURNING *`;
    if (failed) await audit(sql, actorUserId, id, "ai_website.generation_failed", { message });
    return { project: mapProject(failed || claimed), error: message, claimed: true };
  }
}

// Kept for local tooling and direct server-side callers. Production requests
// use queueAutomatedWebsiteProject and the Netlify background worker below.
export async function createAutomatedWebsiteProject(actor, input) {
  const queued = await queueAutomatedWebsiteProject(actor, input);
  const completed = await executeAutomatedWebsiteProject(queued.project.id, queued.jobToken);
  if (!completed || completed.error) {
    const failure = new WebsiteStudioError(completed?.error || "Website generation failed.", "GENERATION_FAILED", 502);
    failure.projectId = queued.project.id;
    throw failure;
  }
  return completed;
}

export async function getWebsitePreview(tokenInput, themeInput) {
  const token = requiredText(tokenInput, "Preview token", 200);
  const theme = cleanText(themeInput, 40).toLowerCase();
  if (!websiteStudioThemes().includes(theme)) throw new WebsiteStudioError("This website concept does not exist.", "PREVIEW_NOT_FOUND", 404);
  const sql = await getWebsiteStudioSql();
  const [row] = await sql`
    SELECT * FROM ai_website_projects
     WHERE preview_token_hash = ${tokenDigest(token)}
       AND site_spec IS NOT NULL
       AND status IN ('generating', 'awaiting_selection', 'published')
       AND (preview_expires_at > now() OR status = 'published')
     LIMIT 1`;
  if (!row) throw new WebsiteStudioError("This private preview is unavailable or has expired.", "PREVIEW_NOT_FOUND", 404);
  if (row.status === "published" && row.selected_theme !== theme) {
    throw new WebsiteStudioError("Another concept was selected and this private preview is now closed.", "PREVIEW_NOT_FOUND", 404);
  }
  return { project: mapProject(row), theme, token };
}

export async function publishSelectedWebsite(tokenInput, themeInput) {
  const token = requiredText(tokenInput, "Preview token", 200);
  const theme = cleanText(themeInput, 40).toLowerCase();
  if (!websiteStudioThemes().includes(theme)) throw new WebsiteStudioError("Choose a valid website concept.", "INVALID_THEME", 400);
  const sql = await getWebsiteStudioSql();
  return sql.begin(async (tx) => {
    const [before] = await tx`
      SELECT * FROM ai_website_projects
       WHERE preview_token_hash = ${tokenDigest(token)}
         AND site_spec IS NOT NULL
         AND status IN ('awaiting_selection', 'published')
         AND (preview_expires_at > now() OR status = 'published')
       FOR UPDATE`;
    if (!before) throw new WebsiteStudioError("This private preview is unavailable or has expired.", "PREVIEW_NOT_FOUND", 404);
    if (before.status === "published" && before.selected_theme !== theme) {
      throw new WebsiteStudioError("A website concept has already been selected and published.", "ALREADY_PUBLISHED", 409);
    }
    const [row] = before.status === "published"
      ? [before]
      : await tx`
          UPDATE ai_website_projects
             SET status = 'published', selected_theme = ${theme}, published_at = now(), updated_at = now()
           WHERE id = ${before.id}
           RETURNING *`;
    if (before.status !== "published") {
      await audit(tx, null, before.id, "ai_website.client_selected_and_published", { theme, publicSlug: row.public_slug });
    }
    const project = mapProject(row);
    return { project, publishedUrl: project.publishedUrl };
  });
}

export async function getPublishedWebsite(slugInput) {
  const slug = requiredText(slugInput, "Website slug", 100).toLowerCase();
  const sql = await getWebsiteStudioSql();
  const [row] = await sql`
    SELECT * FROM ai_website_projects
     WHERE public_slug = ${slug} AND status = 'published' AND site_spec IS NOT NULL
     LIMIT 1`;
  if (!row) throw new WebsiteStudioError("This website was not found.", "WEBSITE_NOT_FOUND", 404);
  return mapProject(row);
}
