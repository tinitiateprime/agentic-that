import { redirect } from "next/navigation";
import { getCurrentPlatformUser } from "@platform/server/auth-store";
import { serviceEndpoints } from "@platform/service-catalog";
import ContentManager from "./ContentManager";

export const metadata = {
  title: "Content Manager - AgenticThat",
  description: "View connected service accounts and content routing by service and app.",
};

export default async function ContentManagerPage({ searchParams }) {
  const user = await getCurrentPlatformUser();
  if (!user) redirect("/?auth=login&next=/content-manager");

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
    <ContentManager
      initialService={requestedService}
      initialMessagingPlatform={requestedMessagingPlatform}
      initialPublishingPlatform={requestedPublishingPlatform}
      user={{ name: user.name, email: user.email, businessName: user.businessName }}
      telegramDashboardUrl={serviceEndpoints.telegram.dashboardUrl}
      publishQueueUrl={serviceEndpoints.publishQueue.consoleUrl}
    />
  );
}
