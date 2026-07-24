import PublishQueueRunner from "../../services/publishing/queue-runner/src/App";
import { createPublishingIdentityToken, getCurrentPlatformUser } from "@platform/server/auth-store";
import { redirect } from "next/navigation";

export const metadata = {
  title: "Publish Queue Runner - AgenticThat",
  description: "Queue, schedule, and publish content across connected social channels.",
};

export default async function PublishingPage() {
  const user = await getCurrentPlatformUser();
  if (!user) {
    redirect("/?auth=login&next=/publishing");
  }

  return <PublishQueueRunner publishingIdentityToken={createPublishingIdentityToken(user)} />;
}
