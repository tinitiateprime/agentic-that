function publicOrigin() {
  const configured = String(process.env.PLATFORM_PUBLIC_URL || process.env.URL || "").trim();
  if (configured) {
    const origin = configured.replace(/\/$/, "");
    if (origin === "https://agentic-that.netlify.app") return "https://agenticthat.com";
    return origin;
  }
  return "http://localhost:3000";
}
export function platformPublicLink(path) {
  return new URL(path, `${publicOrigin()}/`).toString();
}

export function platformAuthLink(path, token) {
  const url = new URL(platformPublicLink(path));
  url.searchParams.set("token", token);
  return url.toString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function platformAuthEmailTemplate({
  preheader,
  eyebrow,
  title,
  introduction,
  actionLabel,
  actionUrl,
  expiry,
  securityNote,
}) {
  const safe = {
    preheader: escapeHtml(preheader),
    eyebrow: escapeHtml(eyebrow),
    title: escapeHtml(title),
    introduction: escapeHtml(introduction).replace(/\r?\n/g, "<br>"),
    actionLabel: escapeHtml(actionLabel),
    actionUrl: escapeHtml(actionUrl),
    expiry: escapeHtml(expiry),
    securityNote: escapeHtml(securityNote),
  };

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${safe.title}</title>
    <style>
      @media only screen and (max-width: 620px) {
        .email-shell { width: 100% !important; border-radius: 0 !important; }
        .email-main { padding: 34px 24px 30px !important; }
        .email-header, .email-footer { padding-left: 24px !important; padding-right: 24px !important; }
        .email-title { font-size: 30px !important; line-height: 36px !important; }
        .email-action { display: block !important; text-align: center !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#f3f4f1;color:#111814;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;line-height:1px;font-size:1px;">${safe.preheader}&#847; &zwnj;&#847; &zwnj;&#847;</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f3f4f1;">
      <tr>
        <td align="center" style="padding:38px 16px;">
          <table role="presentation" class="email-shell" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #dde2de;border-radius:18px;overflow:hidden;box-shadow:0 18px 50px rgba(16,35,27,.08);">
            <tr>
              <td class="email-header" style="padding:22px 34px;border-bottom:1px solid #e8ebe8;background:#fbfcfa;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td width="46" valign="middle">
                      <div style="width:40px;height:40px;border-radius:11px;background:#ffd229;color:#101510;font-size:14px;font-weight:800;line-height:40px;text-align:center;box-shadow:0 7px 18px rgba(244,190,0,.22);">AT</div>
                    </td>
                    <td valign="middle" style="padding-left:10px;color:#111814;font-size:19px;font-weight:800;letter-spacing:-.3px;">AgenticThat</td>
                    <td align="right" valign="middle" style="color:#748078;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;">Secure account email</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="email-main" style="padding:44px 42px 38px;">
                <div style="margin:0 0 13px;color:#8b6a00;font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">${safe.eyebrow}</div>
                <h1 class="email-title" style="margin:0;color:#101510;font-size:36px;font-weight:800;line-height:42px;letter-spacing:-1.2px;">${safe.title}</h1>
                <p style="margin:18px 0 0;color:#536159;font-size:16px;line-height:25px;">${safe.introduction}</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:30px 0 26px;">
                  <tr>
                    <td align="left" style="border-radius:10px;background:#ffd229;box-shadow:0 10px 24px rgba(236,181,0,.2);">
                      <a class="email-action" href="${safe.actionUrl}" style="display:inline-block;padding:15px 24px;color:#111814;font-size:15px;font-weight:800;line-height:20px;text-decoration:none;">${safe.actionLabel}&nbsp;&nbsp;&#8594;</a>
                    </td>
                  </tr>
                </table>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 28px;border:1px solid #e2e8e3;border-radius:10px;background:#f7faf7;">
                  <tr>
                    <td width="42" valign="top" style="padding:15px 0 15px 16px;color:#177052;font-size:18px;line-height:22px;">&#10003;</td>
                    <td style="padding:15px 16px 15px 0;color:#4f6158;font-size:13px;line-height:20px;"><strong style="color:#24342c;">Protected verification</strong><br>${safe.expiry}. This link works once and is tied to your account.</td>
                  </tr>
                </table>
                <p style="margin:0 0 8px;color:#748078;font-size:12px;line-height:19px;">If the button does not work, copy and paste this secure link into your browser:</p>
                <p style="margin:0;word-break:break-all;color:#315e4c;font-size:12px;line-height:19px;"><a href="${safe.actionUrl}" style="color:#315e4c;text-decoration:underline;">${safe.actionUrl}</a></p>
              </td>
            </tr>
            <tr>
              <td class="email-footer" style="padding:24px 34px;border-top:1px solid #e8ebe8;background:#111814;">
                <p style="margin:0 0 8px;color:#f3f5f3;font-size:13px;font-weight:700;">Your account security matters.</p>
                <p style="margin:0;color:#aeb9b2;font-size:12px;line-height:19px;">${safe.securityNote}</p>
                <p style="margin:18px 0 0;color:#7f8c84;font-size:11px;line-height:18px;">AgenticThat &nbsp;&middot;&nbsp; One secure workspace for connected operations<br><a href="https://agenticthat.com" style="color:#d5ddd8;text-decoration:none;">agenticthat.com</a></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function platformProductEmailTemplate({
  preheader,
  eyebrow,
  title,
  introduction,
  actionLabel,
  actionUrl,
  productName,
  productDescription,
  footerNote,
}) {
  const safe = {
    preheader: escapeHtml(preheader),
    eyebrow: escapeHtml(eyebrow),
    title: escapeHtml(title),
    introduction: escapeHtml(introduction).replace(/\r?\n/g, "<br>"),
    actionLabel: escapeHtml(actionLabel),
    actionUrl: escapeHtml(actionUrl),
    productName: escapeHtml(productName),
    productDescription: escapeHtml(productDescription),
    footerNote: escapeHtml(footerNote),
  };
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>${safe.title}</title>
    <style>
      @media only screen and (max-width: 620px) {
        .email-shell { width: 100% !important; border-radius: 0 !important; }
        .email-main, .email-header, .email-footer { padding-left: 24px !important; padding-right: 24px !important; }
        .email-title { font-size: 30px !important; line-height: 36px !important; }
        .email-action { display: block !important; text-align: center !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#f3f4f1;color:#111814;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;">${safe.preheader}&#847; &zwnj;&#847;</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f3f4f1;">
      <tr><td align="center" style="padding:38px 16px;">
        <table role="presentation" class="email-shell" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;background:#fff;border:1px solid #dde2de;border-radius:18px;overflow:hidden;box-shadow:0 18px 50px rgba(16,35,27,.08);">
          <tr><td class="email-header" style="padding:22px 34px;border-bottom:1px solid #e8ebe8;background:#fbfcfa;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
              <td width="46"><div style="width:40px;height:40px;border-radius:11px;background:#ffd229;color:#101510;font-size:14px;font-weight:800;line-height:40px;text-align:center;">AT</div></td>
              <td style="padding-left:10px;color:#111814;font-size:19px;font-weight:800;">AgenticThat</td>
              <td align="right" style="color:#748078;font-size:11px;font-weight:700;text-transform:uppercase;">Product introduction</td>
            </tr></table>
          </td></tr>
          <tr><td class="email-main" style="padding:44px 42px 38px;">
            <div style="margin:0 0 13px;color:#8b6a00;font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">${safe.eyebrow}</div>
            <h1 class="email-title" style="margin:0;color:#101510;font-size:36px;font-weight:800;line-height:42px;letter-spacing:-1.2px;">${safe.title}</h1>
            <p style="margin:18px 0 0;color:#536159;font-size:16px;line-height:25px;">${safe.introduction}</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 0;border:1px solid #dce7e2;border-radius:12px;background:#f7faf8;">
              <tr><td style="padding:18px 20px;">
                <div style="color:#177052;font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;">Selected product</div>
                <div style="margin-top:6px;color:#1b2a23;font-size:18px;font-weight:800;">${safe.productName}</div>
                <div style="margin-top:6px;color:#62736b;font-size:13px;line-height:20px;">${safe.productDescription}</div>
              </td></tr>
            </table>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 22px;"><tr>
              <td align="left" style="border-radius:10px;background:#ffd229;box-shadow:0 10px 24px rgba(236,181,0,.2);">
                <a class="email-action" href="${safe.actionUrl}" style="display:inline-block;padding:15px 24px;color:#111814;font-size:15px;font-weight:800;text-decoration:none;">${safe.actionLabel}&nbsp;&nbsp;&#8594;</a>
              </td>
            </tr></table>
            <p style="margin:0;color:#748078;font-size:12px;line-height:19px;">Or open the official AgenticThat product page:<br><a href="${safe.actionUrl}" style="color:#315e4c;word-break:break-all;">${safe.actionUrl}</a></p>
          </td></tr>
          <tr><td class="email-footer" style="padding:24px 34px;border-top:1px solid #e8ebe8;background:#111814;">
            <p style="margin:0;color:#aeb9b2;font-size:12px;line-height:19px;">${safe.footerNote}</p>
            <p style="margin:16px 0 0;color:#7f8c84;font-size:11px;line-height:18px;">AgenticThat &nbsp;&middot;&nbsp; Business automation, made clear<br><a href="https://agenticthat.com" style="color:#d5ddd8;text-decoration:none;">agenticthat.com</a></p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function emailProvider() {
  return process.env.RESEND_API_KEY?.trim()
    ? "Resend"
    : process.env.AUTH_EMAIL_WEBHOOK_URL?.trim()
      ? "Email webhook"
      : null;
}

function parseSender(value) {
  const from = String(value || "").trim();
  if (!from || /[\r\n]/.test(from)) return null;
  const named = from.match(/^([^<>]+?)\s*<([^<>\s]+@[^<>\s]+\.[^<>\s]+)>$/);
  const plain = from.match(/^([^<>\s]+@[^<>\s]+\.[^<>\s]+)$/);
  if (!named && !plain) return null;
  const email = String(named?.[2] || plain?.[1]).toLowerCase();
  const name = String(named?.[1] || email.split("@")[0]).trim().replace(/^"|"$/g, "");
  if (!name) return null;
  return { id: email, name, email, from: named ? `${name} <${email}>` : email };
}

export function platformEmailStudioConfiguration() {
  const configured = String(process.env.EMAIL_STUDIO_SENDERS || "").trim();
  const candidates = configured ? configured.split(";") : [];
  const senders = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const sender = parseSender(candidate);
    if (sender && !seen.has(sender.id)) {
      seen.add(sender.id);
      senders.push(sender);
    }
  }
  const preferred = String(process.env.EMAIL_STUDIO_DEFAULT_SENDER || "").trim().toLowerCase();
  const defaultSender = senders.find((sender) => sender.id === preferred || sender.email === preferred || sender.from.toLowerCase() === preferred)
    || senders[0]
    || null;
  const provider = emailProvider();
  return {
    configured: Boolean(provider && defaultSender),
    provider,
    from: defaultSender?.from || "Not configured",
    defaultSenderId: defaultSender?.id || null,
    senders,
  };
}

export function resolvePlatformEmailStudioSender(senderId) {
  const configuration = platformEmailStudioConfiguration();
  const requested = String(senderId || "").trim().toLowerCase();
  const sender = configuration.senders.find((item) => item.id === requested);
  if (!configuration.provider || !sender) throw new Error("Choose a configured Email Studio sender.");
  return sender;
}

export async function sendPlatformAuthEmail({ to, subject, text, html, senderId }) {
  const from = senderId
    ? resolvePlatformEmailStudioSender(senderId).from
    : String(process.env.AUTH_EMAIL_FROM || "").trim();
  const resendKey = String(process.env.RESEND_API_KEY || "").trim();
  const webhookUrl = String(process.env.AUTH_EMAIL_WEBHOOK_URL || "").trim();

  if (resendKey && from) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}.`);
    const result = await response.json().catch(() => ({}));
    return { provider: "resend", messageId: String(result.id || "") || null, skipped: false };
  }

  if (webhookUrl && from) {
    const secret = String(process.env.AUTH_EMAIL_WEBHOOK_SECRET || "").trim();
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(secret ? { authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({ from, to, subject, text, html }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Email webhook returned HTTP ${response.status}.`);
    const result = await response.json().catch(() => ({}));
    return { provider: "webhook", messageId: String(result.id || result.messageId || "") || null, skipped: false };
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_EMAIL_FROM and RESEND_API_KEY or AUTH_EMAIL_WEBHOOK_URL are required.");
  }
  console.warn(`Authentication email for ${to} was not sent because no development email provider is configured.`);
  return { provider: "development", messageId: null, skipped: true };
}

export function platformEmailConfiguration() {
  const from = String(process.env.AUTH_EMAIL_FROM || "").trim();
  const provider = emailProvider();
  return {
    configured: Boolean(from && provider),
    from: from || "Not configured",
    provider,
  };
}

export async function sendVerificationEmail(email, token) {
  const link = platformAuthLink("/verify-email", token);
  return sendPlatformAuthEmail({
    to: email,
    subject: "Confirm your email address | AgenticThat",
    text: `AgenticThat\n\nConfirm your email address\n\nYou're one step away from activating your AgenticThat workspace. Verify your email address to securely finish setting up your account.\n\nVerify email address: ${link}\n\nThis secure link expires in 24 hours and works once.\n\nIf you did not create an AgenticThat account, you can safely ignore this email.`,
    html: platformAuthEmailTemplate({
      preheader: "Confirm your email to activate your secure AgenticThat workspace.",
      eyebrow: "Account verification",
      title: "Confirm your email address",
      introduction: "You're one step away from activating your AgenticThat workspace. Verify your email address to securely finish setting up your account.",
      actionLabel: "Verify email address",
      actionUrl: link,
      expiry: "This secure link expires in 24 hours",
      securityNote: "If you did not create an AgenticThat account, you can safely ignore this email. No changes will be made.",
    }),
  });
}

export async function sendPasswordResetEmail(email, token) {
  const link = platformAuthLink("/reset-password", token);
  return sendPlatformAuthEmail({
    to: email,
    subject: "Reset your AgenticThat password",
    text: `AgenticThat\n\nReset your password\n\nWe received a request to reset the password for your AgenticThat account.\n\nChoose a new password: ${link}\n\nThis secure link expires in 30 minutes and works once.\n\nIf you did not request a password reset, you can safely ignore this email.`,
    html: platformAuthEmailTemplate({
      preheader: "Use this secure link to reset your AgenticThat password.",
      eyebrow: "Account security",
      title: "Reset your password",
      introduction: "We received a request to reset the password for your AgenticThat account. Use the secure link below to choose a new password.",
      actionLabel: "Choose a new password",
      actionUrl: link,
      expiry: "This secure link expires in 30 minutes",
      securityNote: "If you did not request a password reset, you can safely ignore this email. Your current password will continue to work.",
    }),
  });
}
