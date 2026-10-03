import { redirect } from "next/navigation";
import OmnichannelComposer from "@platform/OmnichannelComposer";
import { createServiceIdentityToken } from "@platform/server/auth-store";
import { getCurrentPrincipal, principalHasAccess, principalHasCapability } from "@platform/server/access-control";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Omnichannel Messaging — AgenticThat",
  description: "Write one message and send it to your WhatsApp and Telegram audiences from a single composer.",
};

export default async function OmnichannelMessagingPage() {
  const user = await getCurrentPrincipal();
  if (!user) redirect("/?auth=login&next=/messaging");
  if (user.status !== "active") redirect("/pending-approval");

  const canMessage = principalHasCapability(user, "messaging.view");
  const canUseWhatsApp = canMessage && principalHasAccess(user, "messaging.whatsapp", "view");
  const canUseTelegram = canMessage && principalHasAccess(user, "messaging.telegram", "view");
  if (!canUseWhatsApp && !canUseTelegram) redirect("/access-denied?resource=messaging.whatsapp");

  return (
    <OmnichannelComposer
      user={{
        id: user.userId,
        name: user.name,
        email: user.email,
        businessName: user.businessName,
        isGlobalAdmin: user.isGlobalAdmin,
        billingStatus: user.billingStatus,
        trialStartsAt: user.trialStartsAt,
        trialEndsAt: user.trialEndsAt,
        capabilities: user.capabilities,
      }}
      canUseWhatsApp={canUseWhatsApp}
      telegramIdentityToken={canUseTelegram ? await createServiceIdentityToken(user, "telegram") : ""}
    />
  );
}
