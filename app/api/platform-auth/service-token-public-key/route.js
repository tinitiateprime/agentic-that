import { serviceTokenPublicKeyPem } from "@/lib/service-access-token.js";

export async function GET() {
  try {
    const response = Response.json({
      ok: true,
      publicKey: serviceTokenPublicKeyPem(),
      keyId: process.env.SERVICE_TOKEN_KEY_ID?.trim() || "at-ed25519-v1",
      issuer: process.env.SERVICE_TOKEN_ISSUER?.trim() || "agenticthat",
    });
    response.headers.set("Cache-Control", "public, max-age=300");
    return response;
  } catch (error) {
    console.error("Service token public key failed", error);
    return Response.json({ ok: false, error: "Service token public key is unavailable." }, { status: 503 });
  }
}
