import { redirect } from "next/navigation";
import { getCurrentPlatformUser } from "@platform/server/auth-store";
import { serviceEndpoints } from "@platform/service-catalog";
import ConfigManager from "./ConfigManager";

export const metadata = {
  title: "Config Manager - AgenticThat",
  description: "Connect and manage service accounts from one secure workspace.",
};

export default async function ConfigManagerPage({ searchParams }) {
  const user = await getCurrentPlatformUser();
  if (!user) redirect("/?auth=login&next=/config-manager");

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

  return (
    <ConfigManager
      initialService={requestedService}
      initialMessagingPlatform={requestedMessagingPlatform}
      initialPublishingPlatform={requestedPublishingPlatform}
      user={{ name: user.name, email: user.email, businessName: user.businessName }}
      telegramDashboardUrl={serviceEndpoints.telegram.dashboardUrl}
      publishQueueUrl={serviceEndpoints.publishQueue.consoleUrl}
    />
  );
}
