import crypto from "node:crypto";
import { OPERATIONAL_ROLE_IDS } from "../access-catalog.js";
import { productServices, serviceDetailHref } from "../product-catalog.js";
import { getPlatformSql } from "./auth-store.js";
import {
  platformAuthLink,
  platformEmailConfiguration,
  platformEmailStudioConfiguration,
  platformPublicLink,
  resolvePlatformEmailStudioSender,
  sendPlatformAuthEmail,
} from "./auth-email.js";
import {
  normalizeInvitationTemplate,
  renderInvitationEmail,
  STARTER_INVITATION_TEMPLATE,
} from "./invitation-email-template.js";
import {
  normalizeProductInvitationTemplate,
  PRODUCT_INVITATION_TEMPLATE_VARIABLES,
  renderProductInvitationEmail,
  STARTER_PLATFORM_INVITATION_TEMPLATE,
  STARTER_PRODUCT_INVITATION_TEMPLATE,
} from "./product-invitation-email-template.js";
import {
  cancelWorkspaceInvitation,
  inviteWorkspaceMember,
  resendWorkspaceInvitation,
} from "./workspace-team-store.js";

const STARTER_TEMPLATE_ID = "template_workspace_invitation_default";
const STARTER_PRODUCT_TEMPLATE_ID = "template_product_invitation_default";
const STARTER_PLATFORM_TEMPLATE_ID = "template_platform_invitation_default";
const invitationRoleIds = new Set(OPERATIONAL_ROLE_IDS);
const emailLogoUrl = (logo) => {
  const fileName = String(logo || "").split("/").pop().replace(/\.svg$/i, ".png");
  return fileName ? platformPublicLink(`/email-icons/${fileName}`) : null;
};
const serviceInvitationProducts = productServices
  .filter((product) => product.availability === "live")
  .map((product) => ({
    key: `${product.category}:${product.slug}`,
    invitationType: "service",
    category: product.category,
    slug: product.slug,
    name: product.name,
    description: product.shortDescription,
    logo: product.logo,
    emailLogo: emailLogoUrl(product.logo),
    iconName: product.platformName || product.name.replace(/ (Messaging|Publishing|Public Data)$/, ""),
    url: platformPublicLink(serviceDetailHref(product)),
    highlights: [],
  }));
const serviceNames = (category) => serviceInvitationProducts
  .filter((product) => product.category === category)
  .map((product) => product.name.replace(/ (Messaging|Publishing)$/, ""))
  .join(" · ");
const serviceLogos = (category) => serviceInvitationProducts
  .filter((product) => product.category === category && product.emailLogo)
  .map((product) => ({ src: product.emailLogo, name: product.iconName }))
  .filter((logo, index, logos) => logos.findIndex((item) => item.src === logo.src) === index)
  .slice(0, 5);
const platformInvitationProduct = {
  key: "platform:agenticthat",
  invitationType: "platform",
  category: "platform",
  slug: "agenticthat",
  name: "AgenticThat",
  description: "A practical automation platform for customer messaging, social publishing, and structured public-data workflows.",
  logo: null,
  url: platformPublicLink("/apps"),
  highlights: [
    {
      key: "messaging",
      name: "Messaging",
      description: "Manage conversations, outreach, templates, and follow-ups from connected business accounts.",
      services: serviceNames("messaging"),
      logos: serviceLogos("messaging"),
    },
    {
      key: "publishing",
      name: "Publishing",
      description: "Prepare, preview, publish, and track content across the social channels your team uses.",
      services: serviceNames("publishing"),
      logos: serviceLogos("publishing"),
    },
    {
      key: "scraping",
      name: "Public data",
      description: "Collect structured public Instagram and Facebook signals for research and review.",
      services: serviceNames("scraping"),
      logos: serviceLogos("scraping"),
    },
  ],
};
const invitationalProducts = [platformInvitationProduct, ...serviceInvitationProducts];
const productByKey = new Map(invitationalProducts.map((product) => [product.key, product]));

function requiredText(value, label, max = 200) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) throw new Error(`${label} is required.`);
  return normalized;
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error("Enter a valid recipient email address.");
  }
  return email;
}

function normalizeRoleIds(value) {
  const roleIds = [...new Set((Array.isArray(value) ? value : []).map(String))];
  if (!roleIds.length) throw new Error("Assign at least one role.");
  if (roleIds.some((roleId) => !invitationRoleIds.has(roleId))) {
    throw new Error("One or more invitation roles are invalid.");
  }
  return roleIds;
}

function templateContent(template) {
  return {
    ...(template.invitationType ? { invitationType: template.invitationType } : {}),
    preheader: template.preheader,
    eyebrow: template.eyebrow,
    heading: template.heading,
    body: template.body,
    buttonLabel: template.buttonLabel,
    footer: template.footer,
  };
}

function publicTemplate(row) {
  const content = row.content && typeof row.content === "object" ? row.content : {};
  return {
    id: String(row.id),
    purpose: row.purpose,
    invitationType: content.invitationType || (row.purpose === "product_invitation" ? "service" : null),
    channel: row.channel,
    name: row.name,
    description: row.description || "",
    subject: row.subject,
    preheader: content.preheader || "",
    eyebrow: content.eyebrow || "Workspace invitation",
    heading: content.heading || "",
    body: content.body || "",
    buttonLabel: content.buttonLabel || "Accept invitation",
    footer: content.footer || "",
    status: row.status,
    version: Number(row.version || 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function privateTemplate(row) {
  return normalizeInvitationTemplate(row?.content ? publicTemplate(row) : row);
}

function privateProductTemplate(row) {
  return normalizeProductInvitationTemplate(row?.content ? publicTemplate(row) : row);
}

function publicDelivery(row, invitation) {
  return {
    id: String(row.id),
    invitationId: row.invitation_id,
    templateId: row.template_id,
    templateName: row.template_name || row.template_snapshot?.name || "Archived template",
    templateVersion: Number(row.template_version || 1),
    recipientName: row.recipient_name || "",
    recipientEmail: row.recipient_email,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name || "Unavailable workspace",
    roleIds: Array.isArray(row.role_ids) ? row.role_ids.map(String) : [],
    subject: row.subject_snapshot,
    status: row.status,
    invitationStatus: invitation?.status || "unknown",
    attemptCount: Number(row.attempt_count || 0),
    provider: row.provider,
    providerMessageId: row.provider_message_id,
    error: row.error,
    queuedAt: row.queued_at,
    sentAt: row.sent_at,
    updatedAt: row.updated_at,
  };
}

function publicProductDelivery(row) {
  return {
    id: String(row.id),
    templateId: row.template_id,
    templateName: row.template_name || row.template_snapshot?.name || "Archived template",
    templateVersion: Number(row.template_version || 1),
    recipientName: row.recipient_name || "",
    recipientEmail: row.recipient_email,
    productKey: row.product_key,
    invitationType: row.product_key === platformInvitationProduct.key ? "platform" : "service",
    productName: row.product_name || "Unavailable product",
    productDescription: row.product_description || "",
    productUrl: row.product_url,
    senderId: row.sender_id,
    senderFrom: row.sender_from || "Unavailable sender",
    subject: row.subject_snapshot,
    status: row.status,
    attemptCount: Number(row.attempt_count || 0),
    provider: row.provider,
    providerMessageId: row.provider_message_id,
    error: row.error,
    queuedAt: row.queued_at,
    sentAt: row.sent_at,
    updatedAt: row.updated_at,
  };
}

async function audit(tx, actorUserId, targetType, targetId, action, before, after) {
  await tx`
    INSERT INTO rbac_audit_events
      (id, actor_user_id, target_type, target_id, action, before_value, after_value)
    VALUES
      (${crypto.randomUUID()}, ${actorUserId}, ${targetType}, ${targetId}, ${action},
       ${before ? tx.json(before) : null}, ${after ? tx.json(after) : null})`;
}

async function ensureStarterTemplate(sql) {
  const starter = normalizeInvitationTemplate(STARTER_INVITATION_TEMPLATE);
  await sql`
    INSERT INTO notification_templates
      (id, purpose, channel, name, description, subject, content, status, version)
    VALUES
      (${STARTER_TEMPLATE_ID}, 'workspace_invitation', 'email', ${starter.name},
       ${starter.description}, ${starter.subject}, ${sql.json(templateContent(starter))},
       'published', 1)
    ON CONFLICT DO NOTHING`;

  const productStarter = normalizeProductInvitationTemplate(STARTER_PRODUCT_INVITATION_TEMPLATE);
  await sql`
    INSERT INTO notification_templates
      (id, purpose, channel, name, description, subject, content, status, version)
    VALUES
      (${STARTER_PRODUCT_TEMPLATE_ID}, 'product_invitation', 'email', ${productStarter.name},
       ${productStarter.description}, ${productStarter.subject}, ${sql.json(templateContent(productStarter))},
       'published', 1)
    ON CONFLICT DO NOTHING`;

  const platformStarter = normalizeProductInvitationTemplate(STARTER_PLATFORM_INVITATION_TEMPLATE);
  await sql`
    INSERT INTO notification_templates
      (id, purpose, channel, name, description, subject, content, status, version)
    VALUES
      (${STARTER_PLATFORM_TEMPLATE_ID}, 'product_invitation', 'email', ${platformStarter.name},
       ${platformStarter.description}, ${platformStarter.subject}, ${sql.json(templateContent(platformStarter))},
       'published', 1)
    ON CONFLICT DO NOTHING`;
}

async function templateRow(sql, templateId, { published = false, purpose = null } = {}) {
  const rows = published
    ? await sql`SELECT * FROM notification_templates WHERE id = ${templateId} AND status = 'published' AND (${purpose}::text IS NULL OR purpose = ${purpose}) LIMIT 1`
    : await sql`SELECT * FROM notification_templates WHERE id = ${templateId} AND (${purpose}::text IS NULL OR purpose = ${purpose}) LIMIT 1`;
  if (!rows[0]) throw new Error(published ? "Choose a published invitation template." : "Template not found.");
  return rows[0];
}

async function invitationContext(sql, workspaceIdInput, roleIdsInput) {
  const workspaceId = requiredText(workspaceIdInput, "Workspace", 220);
  const roleIds = normalizeRoleIds(roleIdsInput);
  const [workspace] = await sql`
    SELECT id, name FROM platform_workspaces
     WHERE id = ${workspaceId} AND status = 'active' LIMIT 1`;
  if (!workspace) throw new Error("Choose an active workspace.");
  const roles = await sql`
    SELECT id, name FROM rbac_roles
     WHERE id = ANY(${roleIds}) AND is_system = true AND is_self_selectable = false`;
  if (roles.length !== roleIds.length) throw new Error("One or more invitation roles are unavailable.");
  const roleById = new Map(roles.map((role) => [String(role.id), role.name]));
  return { workspace, roleIds, roleNames: roleIds.map((id) => roleById.get(id)) };
}

function renderContext({ actor, recipientName, recipientEmail, workspaceName, roleNames, invitationUrl }) {
  return {
    recipient_name: recipientName || "there",
    recipient_email: recipientEmail,
    workspace_name: workspaceName,
    role_names: roleNames.join(", "),
    inviter_name: actor.name || actor.email || "AgenticThat",
    invitation_url: invitationUrl,
    expires_in: "7 days",
  };
}

function assertEmailReady() {
  const sender = platformEmailConfiguration();
  if (!sender.configured) {
    throw new Error("Configure AUTH_EMAIL_FROM and RESEND_API_KEY or AUTH_EMAIL_WEBHOOK_URL before sending invitations.");
  }
  return sender;
}

export async function adminCommunicationsSnapshot() {
  const sql = await getPlatformSql();
  await ensureStarterTemplate(sql);
  const templates = await sql`
    SELECT * FROM notification_templates
     WHERE purpose = 'product_invitation' AND channel = 'email'
     ORDER BY CASE status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
              updated_at DESC`;
  const deliveries = await sql`
    SELECT delivery.*, template.name AS template_name
      FROM notification_deliveries delivery
      LEFT JOIN notification_templates template ON template.id = delivery.template_id
     WHERE delivery.channel = 'email' AND delivery.purpose = 'product_invitation'
     ORDER BY delivery.queued_at DESC
     LIMIT 150`;
  return {
    sender: platformEmailStudioConfiguration(),
    variables: PRODUCT_INVITATION_TEMPLATE_VARIABLES,
    products: invitationalProducts,
    templates: templates.map(publicTemplate),
    deliveries: deliveries.map(publicProductDelivery),
  };
}

export async function createInvitationTemplate(actor, input) {
  const sql = await getPlatformSql();
  const template = normalizeProductInvitationTemplate(input);
  const id = `template_${crypto.randomUUID()}`;
  try {
    const [row] = await sql.begin(async (tx) => {
      const inserted = await tx`
        INSERT INTO notification_templates
          (id, purpose, channel, name, description, subject, content, status, version, created_by, updated_by)
        VALUES
          (${id}, 'product_invitation', 'email', ${template.name}, ${template.description},
           ${template.subject}, ${tx.json(templateContent(template))}, ${template.status}, 1,
           ${actor.userId}, ${actor.userId})
        RETURNING *`;
      await audit(tx, actor.userId, "notification_template", id, "notification_template.created", null, publicTemplate(inserted[0]));
      return inserted;
    });
    return publicTemplate(row);
  } catch (error) {
    if (error?.code === "23505") throw new Error("An active template with this name already exists.");
    throw error;
  }
}

export async function updateInvitationTemplate(actor, templateIdInput, input) {
  const sql = await getPlatformSql();
  const templateId = requiredText(templateIdInput, "Template ID", 220);
  return sql.begin(async (tx) => {
    const beforeRow = await templateRow(tx, templateId, { purpose: "product_invitation" });
    const before = publicTemplate(beforeRow);
    const next = normalizeProductInvitationTemplate({ ...before, ...input });
    try {
      const [row] = await tx`
        UPDATE notification_templates
           SET name = ${next.name}, description = ${next.description}, subject = ${next.subject},
               content = ${tx.json(templateContent(next))}, status = ${next.status},
               version = version + 1, updated_by = ${actor.userId}, updated_at = now()
         WHERE id = ${templateId}
         RETURNING *`;
      await audit(tx, actor.userId, "notification_template", templateId, `notification_template.${next.status === "archived" ? "archived" : "updated"}`, before, publicTemplate(row));
      return publicTemplate(row);
    } catch (error) {
      if (error?.code === "23505") throw new Error("An active template with this name already exists.");
      throw error;
    }
  });
}

export async function sendInvitationTemplateTest(actor, input) {
  const sender = resolvePlatformEmailStudioSender(input.senderId);
  const recipientEmail = normalizeEmail(input.email);
  const template = normalizeProductInvitationTemplate(input.template);
  const product = productByKey.get(String(input.productKey || "")) || invitationalProducts[0];
  if (!product) throw new Error("Choose an available AgenticThat product.");
  if (template.invitationType !== product.invitationType) {
    throw new Error(`Choose a ${template.invitationType === "platform" ? "platform" : "single-service"} preview.`);
  }
  const rendered = renderProductInvitationEmail(template, {
    recipient_name: "Alex Morgan",
    recipient_email: recipientEmail,
    product_name: product.name,
    product_description: product.description,
    product_url: product.url,
    product_logo: product.emailLogo,
    sender_name: sender.name,
    company_name: "AgenticThat",
    service_highlights: product.highlights,
  });
  const result = await sendPlatformAuthEmail({
    to: recipientEmail,
    subject: `[TEST] ${rendered.subject}`,
    text: rendered.text,
    html: rendered.html,
    senderId: sender.id,
  });
  const sql = await getPlatformSql();
  await audit(sql, actor.userId, "notification_template", null, "notification_template.test_sent", null, {
    templateName: template.name,
    recipientEmail,
    productKey: product.key,
    senderId: sender.id,
    provider: result.provider,
  });
  return { recipientEmail, provider: result.provider };
}

async function markDeliveryAttempt(sql, deliveryId, values) {
  const status = values.error ? "failed" : "sent";
  const [row] = await sql`
    UPDATE notification_deliveries
       SET status = ${status}, provider = ${values.provider || null},
           provider_message_id = ${values.messageId || null}, error = ${values.error || null},
           attempt_count = attempt_count + 1, last_attempt_at = now(),
           sent_at = ${status === "sent" ? new Date().toISOString() : null}, updated_at = now()
     WHERE id = ${deliveryId}
     RETURNING *`;
  return row;
}

async function deliverInvitation({ sql, actor, delivery, template, context, invitationUrl }) {
  const rendered = renderInvitationEmail(privateTemplate(template), renderContext({
    actor,
    recipientName: delivery.recipient_name,
    recipientEmail: delivery.recipient_email,
    workspaceName: context.workspace.name,
    roleNames: context.roleNames,
    invitationUrl,
  }));
  try {
    const result = await sendPlatformAuthEmail({
      to: delivery.recipient_email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
    const row = await markDeliveryAttempt(sql, delivery.id, result);
    await audit(sql, actor.userId, "notification_delivery", delivery.id, "notification_delivery.sent", null, {
      invitationId: delivery.invitation_id,
      recipientEmail: delivery.recipient_email,
      provider: result.provider,
      attemptCount: row.attempt_count,
    });
    return { row, error: null };
  } catch (error) {
    const message = (error instanceof Error ? error.message : "Email delivery failed.").slice(0, 1000);
    const row = await markDeliveryAttempt(sql, delivery.id, { error: message });
    await audit(sql, actor.userId, "notification_delivery", delivery.id, "notification_delivery.failed", null, {
      invitationId: delivery.invitation_id,
      recipientEmail: delivery.recipient_email,
      error: message,
      attemptCount: row.attempt_count,
    });
    return { row, error: message };
  }
}

function productRenderContext({ recipientName, recipientEmail, product, sender }) {
  return {
    recipient_name: recipientName || "there",
    recipient_email: recipientEmail,
    product_name: product.name,
    product_description: product.description,
    product_url: product.url,
    product_logo: product.emailLogo,
    sender_name: sender.name,
    company_name: "AgenticThat",
    service_highlights: product.highlights || [],
  };
}

async function deliverProductInvitation({ sql, actor, delivery, template, sender }) {
  const catalogProduct = productByKey.get(delivery.product_key);
  const product = {
    key: delivery.product_key,
    name: delivery.product_name,
    description: delivery.product_description,
    url: delivery.product_url,
    emailLogo: catalogProduct?.emailLogo || null,
    highlights: catalogProduct?.highlights || [],
  };
  const rendered = renderProductInvitationEmail(
    privateProductTemplate(template),
    productRenderContext({
      recipientName: delivery.recipient_name,
      recipientEmail: delivery.recipient_email,
      product,
      sender,
    }),
  );
  try {
    const result = await sendPlatformAuthEmail({
      to: delivery.recipient_email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      senderId: sender.id,
    });
    const row = await markDeliveryAttempt(sql, delivery.id, result);
    await audit(sql, actor.userId, "notification_delivery", delivery.id, "product_invitation.sent", null, {
      recipientEmail: delivery.recipient_email,
      productKey: delivery.product_key,
      senderId: sender.id,
      provider: result.provider,
      attemptCount: row.attempt_count,
    });
    return { row, error: null };
  } catch (error) {
    const message = (error instanceof Error ? error.message : "Email delivery failed.").slice(0, 1000);
    const row = await markDeliveryAttempt(sql, delivery.id, { error: message });
    await audit(sql, actor.userId, "notification_delivery", delivery.id, "product_invitation.failed", null, {
      recipientEmail: delivery.recipient_email,
      productKey: delivery.product_key,
      senderId: sender.id,
      error: message,
      attemptCount: row.attempt_count,
    });
    return { row, error: message };
  }
}

export async function sendAdminProductInvitation(actor, input) {
  const sql = await getPlatformSql();
  const recipientEmail = normalizeEmail(input.email);
  const recipientName = String(input.recipientName || "").trim().slice(0, 100);
  const templateId = requiredText(input.templateId, "Template", 220);
  const product = productByKey.get(requiredText(input.productKey, "Product", 220));
  if (!product) throw new Error("Choose an available AgenticThat product.");
  const sender = resolvePlatformEmailStudioSender(input.senderId);
  const template = await templateRow(sql, templateId, { published: true, purpose: "product_invitation" });
  const templateValue = privateProductTemplate(template);
  if (templateValue.invitationType !== product.invitationType) {
    throw new Error(`Choose a published ${product.invitationType === "platform" ? "AgenticThat overview" : "single-service"} template.`);
  }
  const rendered = renderProductInvitationEmail(templateValue, productRenderContext({
    recipientName,
    recipientEmail,
    product,
    sender,
  }));
  const deliveryId = `delivery_${crypto.randomUUID()}`;
  const [delivery] = await sql`
    INSERT INTO notification_deliveries
      (id, purpose, template_id, template_version, template_snapshot,
       recipient_name, recipient_email, channel, product_key, product_name,
       product_description, product_url, sender_id, sender_from,
       subject_snapshot, status, created_by)
    VALUES
      (${deliveryId}, 'product_invitation', ${template.id}, ${template.version},
       ${sql.json({ ...templateValue, name: template.name })}, ${recipientName}, ${recipientEmail},
       'email', ${product.key}, ${product.name}, ${product.description}, ${product.url},
       ${sender.id}, ${sender.from}, ${rendered.subject}, 'queued', ${actor.userId})
    RETURNING *`;
  const result = await deliverProductInvitation({ sql, actor, delivery, template, sender });
  return {
    delivery: publicProductDelivery({ ...result.row, template_name: template.name }),
    error: result.error,
  };
}

export async function retryAdminProductInvitation(actor, deliveryIdInput) {
  const sql = await getPlatformSql();
  const deliveryId = requiredText(deliveryIdInput, "Delivery ID", 220);
  const [delivery] = await sql`
    SELECT delivery.*, template.name AS template_name
      FROM notification_deliveries delivery
      LEFT JOIN notification_templates template ON template.id = delivery.template_id
     WHERE delivery.id = ${deliveryId} AND delivery.purpose = 'product_invitation'
     LIMIT 1`;
  if (!delivery) throw new Error("Product invitation delivery not found.");
  const sender = resolvePlatformEmailStudioSender(delivery.sender_id);
  const [claimed] = await sql`
    UPDATE notification_deliveries
       SET status = 'queued', error = NULL, updated_at = now()
     WHERE id = ${delivery.id}
       AND (status <> 'queued' OR updated_at < now() - interval '2 minutes')
     RETURNING *`;
  if (!claimed) throw new Error("This email is already being processed. Refresh its status in a moment.");
  const result = await deliverProductInvitation({
    sql,
    actor,
    delivery: { ...delivery, ...claimed },
    template: delivery.template_snapshot,
    sender,
  });
  return {
    delivery: publicProductDelivery({ ...result.row, template_name: delivery.template_name }),
    error: result.error,
  };
}

export async function sendAdminWorkspaceInvitation(actor, input) {
  assertEmailReady();
  const sql = await getPlatformSql();
  const recipientEmail = normalizeEmail(input.email);
  const recipientName = String(input.recipientName || "").trim().slice(0, 100);
  const templateId = requiredText(input.templateId, "Template", 220);
  const context = await invitationContext(sql, input.workspaceId, input.roleIds);
  const template = await templateRow(sql, templateId, { published: true, purpose: "workspace_invitation" });
  const templateValue = privateTemplate(template);
  const baseRenderValues = {
    actor,
    recipientName,
    recipientEmail,
    workspaceName: context.workspace.name,
    roleNames: context.roleNames,
  };
  renderInvitationEmail(templateValue, renderContext({
    ...baseRenderValues,
    invitationUrl: platformAuthLink("/join-workspace", "invitation-validation"),
  }));
  const invitation = await inviteWorkspaceMember(
    { ...actor, workspaceId: context.workspace.id },
    { email: recipientEmail, roleIds: context.roleIds },
  );
  const invitationUrl = platformAuthLink("/join-workspace", invitation.token);
  const subject = renderInvitationEmail(templateValue, renderContext({
    ...baseRenderValues,
    invitationUrl,
  })).subject;
  const deliveryId = `delivery_${crypto.randomUUID()}`;
  let delivery;
  try {
    [delivery] = await sql`
      INSERT INTO notification_deliveries
        (id, invitation_id, template_id, template_version, template_snapshot,
         recipient_name, recipient_email, workspace_id, role_ids, channel,
         subject_snapshot, status, created_by)
      VALUES
        (${deliveryId}, ${invitation.id}, ${template.id}, ${template.version},
         ${sql.json({ ...templateValue, name: template.name })}, ${recipientName}, ${recipientEmail},
         ${context.workspace.id}, ${sql.json(context.roleIds)}, 'email', ${subject}, 'queued', ${actor.userId})
      RETURNING *`;
  } catch (error) {
    await cancelWorkspaceInvitation(
      { ...actor, workspaceId: context.workspace.id },
      invitation.id,
    ).catch((cancelError) => console.error("Unable to roll back an untracked workspace invitation", cancelError));
    throw error;
  }
  const result = await deliverInvitation({ sql, actor, delivery, template, context, invitationUrl });
  return {
    delivery: publicDelivery({ ...result.row, template_name: template.name, workspace_name: context.workspace.name }, invitation),
    error: result.error,
  };
}

async function deliveryContext(sql, deliveryIdInput) {
  const deliveryId = requiredText(deliveryIdInput, "Delivery ID", 220);
  const [delivery] = await sql`
    SELECT delivery.*, template.name AS template_name, workspace.name AS workspace_name
     FROM notification_deliveries delivery
      LEFT JOIN notification_templates template ON template.id = delivery.template_id
      LEFT JOIN platform_workspaces workspace ON workspace.id = delivery.workspace_id
     WHERE delivery.id = ${deliveryId} AND delivery.purpose = 'workspace_invitation'
     LIMIT 1`;
  if (!delivery) throw new Error("Invitation delivery not found.");
  return delivery;
}

export async function retryAdminWorkspaceInvitation(actor, deliveryIdInput) {
  assertEmailReady();
  const sql = await getPlatformSql();
  const delivery = await deliveryContext(sql, deliveryIdInput);
  const context = await invitationContext(sql, delivery.workspace_id, delivery.role_ids);
  const template = delivery.template_snapshot;
  const [claimed] = await sql`
    UPDATE notification_deliveries
       SET status = 'queued', error = NULL, updated_at = now()
     WHERE id = ${delivery.id}
       AND (status <> 'queued' OR updated_at < now() - interval '2 minutes')
     RETURNING *`;
  if (!claimed) throw new Error("This invitation is already being processed. Refresh its status in a moment.");
  let invitation;
  try {
    invitation = await resendWorkspaceInvitation(
      { ...actor, workspaceId: context.workspace.id },
      delivery.invitation_id,
    );
  } catch (error) {
    await sql`
      UPDATE notification_deliveries
         SET status = ${delivery.status}, error = ${delivery.error}, updated_at = now()
       WHERE id = ${delivery.id} AND status = 'queued'`;
    throw error;
  }
  const result = await deliverInvitation({
    sql,
    actor,
    delivery: { ...delivery, ...claimed },
    template,
    context,
    invitationUrl: platformAuthLink("/join-workspace", invitation.token),
  });
  return {
    delivery: publicDelivery({ ...result.row, template_name: delivery.template_name, workspace_name: context.workspace.name }, invitation),
    error: result.error,
  };
}

export async function cancelAdminWorkspaceInvitation(actor, deliveryIdInput) {
  const sql = await getPlatformSql();
  const delivery = await deliveryContext(sql, deliveryIdInput);
  const invitation = await cancelWorkspaceInvitation(
    { ...actor, workspaceId: delivery.workspace_id },
    delivery.invitation_id,
  );
  await audit(sql, actor.userId, "notification_delivery", delivery.id, "notification_delivery.invitation_canceled", null, {
    invitationId: invitation.id,
    recipientEmail: delivery.recipient_email,
  });
  return { id: delivery.id, invitationStatus: invitation.status };
}
