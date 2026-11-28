import ProductShell from "@platform/ProductShell";
import PublishQueueRunner from "../../../services/publishing/queue-runner/src/App";
import { createPublishingIdentityToken } from "@platform/server/auth-store";
import { requireAccess, requirePrincipalCapability } from "@platform/server/access-control";

export const metadata = {
  title: "Publishing - AgenticThat",
  description: "Write posts yourself or with AI, then publish and schedule them across your connected social accounts.",
};

export default async function PublishingPage({ searchParams }) {
  const params = await searchParams;
  const platform = ["instagram", "facebook", "x", "youtube", "linkedin", "reddit"].includes(params?.platform) ? params.platform : "instagram";
  const accessUser = await requireAccess(`publishing.${platform}`, "view", `/publishing?platform=${platform}`);
  const user = await requirePrincipalCapability(accessUser, "publishing.view", `/publishing?platform=${platform}`);

  return (
    <ProductShell user={user} active="publishing" embedded>
      <PublishQueueRunner publishingIdentityToken={await createPublishingIdentityToken(user)} />
    </ProductShell>
  );
}
