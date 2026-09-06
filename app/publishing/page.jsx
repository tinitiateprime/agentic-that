import PublishQueueRunner from "../../services/publishing/queue-runner/src/App";
import { createPublishingIdentityToken } from "@platform/server/auth-store";
import { requireAccess, requirePrincipalCapability } from "@platform/server/access-control";

export const metadata = {
  title: "Publish Queue Runner - AgenticThat",
  description: "Prepare, queue, and publish content across connected social channels.",
};

export default async function PublishingPage({ searchParams }) {
  const params = await searchParams;
  const platform = ["instagram", "facebook", "x", "youtube", "linkedin"].includes(params?.platform) ? params.platform : "instagram";
  const accessUser = await requireAccess(`publishing.${platform}`, "view", `/publishing?platform=${platform}`);
  const user = await requirePrincipalCapability(accessUser, "publishing.view", `/publishing?platform=${platform}`);

  return <PublishQueueRunner publishingIdentityToken={await createPublishingIdentityToken(user)} />;
}
