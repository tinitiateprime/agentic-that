import { createPublishingIdentityToken, createServiceIdentityToken } from "@platform/server/auth-store";
import { principalHasAccess, principalHasCapability, requireAccess, requireCapability } from "@platform/server/access-control";
import { serviceEndpoints } from "@platform/service-catalog";
import ContentManager from "./ContentManager";

export const metadata = {
  title: "Content Manager - AgenticThat",
  description: "View connected service accounts and content routing by service and app.",
};

export default async function ContentManagerPage({ searchParams }) {
  const params = await searchParams;
  const legacyMessagingService = ["telegram", "whatsapp"].includes(params?.service);
  const requestedService = legacyMessagingService
    ? "messaging"
    : ["messaging", "publishing", "engagement"].includes(params?.service)
      ? params.service
      : "messaging";
  const requestedMessagingPlatform = params?.service === "whatsapp" || params?.platform === "whatsapp"
    ? "whatsapp"
    : "telegram";
  const requestedPublishingPlatform = ["instagram", "facebook", "x", "youtube", "linkedin"].includes(params?.platform)
    ? params.platform
    : "instagram";
  const requestedResource = requestedService === "publishing"
    ? `publishing.${requestedPublishingPlatform}`
    : `messaging.${requestedMessagingPlatform}`;
  let user = await requireAccess(requestedResource, "view", "/content-manager");
  user = await requireCapability(requestedService === "publishing" ? "publishing.view" : "messaging.view", "/content-manager");
  const canUsePublishing = ["instagram", "facebook", "x", "youtube", "linkedin"]
    .some((platform) => principalHasAccess(user, `publishing.${platform}`, "view"))
    && principalHasCapability(user, "publishing.view");
  const canUseTelegram = principalHasAccess(user, "messaging.telegram", "view") && principalHasCapability(user, "messaging.view");

  return (
    <ContentManager
      initialService={requestedService}
      initialMessagingPlatform={requestedMessagingPlatform}
      initialPublishingPlatform={requestedPublishingPlatform}
      publishingIdentityToken={canUsePublishing ? await createPublishingIdentityToken(user) : ""}
      telegramIdentityToken={canUseTelegram ? await createServiceIdentityToken(user, "telegram") : ""}
      effectiveAccess={user.access}
      user={{ name: user.name, email: user.email, businessName: user.businessName, isGlobalAdmin: user.isGlobalAdmin, billingStatus: user.billingStatus, trialStartsAt: user.trialStartsAt, trialEndsAt: user.trialEndsAt, capabilities: user.capabilities }}
      telegramDashboardUrl={serviceEndpoints.telegram.dashboardUrl}
      publishQueueUrl={serviceEndpoints.publishQueue.consoleUrl}
    />
  );
}
