import PublishQueueRunner from "../../services/publishing/queue-runner/src/App";
import { getCurrentPlatformUser } from "@platform/server/auth-store";
import { redirect } from "next/navigation";

export const metadata = {
  title: "Publish Queue Runner - AgenticThat",
  description: "Queue, schedule, and publish content across connected social channels.",
};

export default async function PublishingPage() {
  if (!(await getCurrentPlatformUser())) {
    redirect("/?auth=login&next=/publishing");
  }

  return <PublishQueueRunner />;
}
