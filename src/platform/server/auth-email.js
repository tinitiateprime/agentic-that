function publicOrigin() {
  const configured = String(process.env.PLATFORM_PUBLIC_URL || process.env.URL || "").trim();
  if (configured) return configured.replace(/\/$/, "");
  return "http://localhost:3000";
}
export function platformAuthLink(path, token) {
  const url = new URL(path, `${publicOrigin()}/`);
  url.searchParams.set("token", token);
  return url.toString();
}

export async function sendPlatformAuthEmail({ to, subject, text, html }) {
  const from = String(process.env.AUTH_EMAIL_FROM || "").trim();
  const resendKey = String(process.env.RESEND_API_KEY || "").trim();
  const webhookUrl = String(process.env.AUTH_EMAIL_WEBHOOK_URL || "").trim();

  if (resendKey && from) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text, html }),
    });
    if (!response.ok) throw new Error(`Authentication email provider returned HTTP ${response.status}.`);
    return;
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
    });
    if (!response.ok) throw new Error(`Authentication email webhook returned HTTP ${response.status}.`);
    return;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_EMAIL_FROM and RESEND_API_KEY or AUTH_EMAIL_WEBHOOK_URL are required.");
  }
  console.warn(`Authentication email for ${to} was not sent because no development email provider is configured.`);
}

export async function sendVerificationEmail(email, token) {
  const link = platformAuthLink("/verify-email", token);
  return sendPlatformAuthEmail({
    to: email,
    subject: "Verify your AgenticThat email",
    text: `Verify your AgenticThat account: ${link}\n\nThis link expires in 24 hours.`,
    html: `<p>Verify your AgenticThat account:</p><p><a href="${link}">Verify email</a></p><p>This link expires in 24 hours.</p>`,
  });
}

export async function sendPasswordResetEmail(email, token) {
  const link = platformAuthLink("/reset-password", token);
  return sendPlatformAuthEmail({
    to: email,
    subject: "Reset your AgenticThat password",
    text: `Reset your AgenticThat password: ${link}\n\nThis link expires in 30 minutes.`,
    html: `<p>Reset your AgenticThat password:</p><p><a href="${link}">Reset password</a></p><p>This link expires in 30 minutes.</p>`,
  });
}
