import PublishQueueRunner from "../../services/publishing/queue-runner/src/App";
import ProductShell from "@platform/ProductShell";
import { createPublishingIdentityToken } from "@platform/server/auth-store";
import { requireAccess, requireCapability } from "@platform/server/access-control";

export const metadata = {
  title: "Publish Queue Runner - AgenticThat",
  description: "Queue, schedule, and publish content across connected social channels.",
};

export default async function PublishingPage({ searchParams }) {
  const params = await searchParams;
  const platform = ["instagram", "facebook", "x", "youtube", "linkedin"].includes(params?.platform) ? params.platform : "instagram";
  await requireAccess(`publishing.${platform}`, "view", `/publishing?platform=${platform}`);
  const user = await requireCapability("publishing.view", `/publishing?platform=${platform}`);

  return (
    <ProductShell
      user={{ id: user.userId, name: user.name, email: user.email, businessName: user.businessName, isGlobalAdmin: user.isGlobalAdmin, billingStatus: user.billingStatus, trialStartsAt: user.trialStartsAt, trialEndsAt: user.trialEndsAt, capabilities: user.capabilities }}
      active="apps"
    >
      <PublishQueueRunner publishingIdentityToken={await createPublishingIdentityToken(user)} />
    </ProductShell>
  );
}
