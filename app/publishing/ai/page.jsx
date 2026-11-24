import PublishingMenu from "../../../services/publishing/queue-runner/src/PublishingMenu.tsx";
import SocialSeoWorkspace from "@platform/social-seo/SocialSeoWorkspace";
import { requireOpenServicePrincipal } from "@platform/server/access-control";
import { createPublishingIdentityToken } from "@platform/server/auth-store";
import styles from "./publishing-ai.module.css";

export const metadata = {
  title: "Create with AI - Publishing - AgenticThat",
  description: "Upload a picture or video and get ready-to-post captions, hashtags and alt text for each app, written by your own ChatGPT, Claude or Gemini, then post them.",
};

export const dynamic = "force-dynamic";

// Publishing → Create with AI (formerly Social SEO). Open to every signed-in
// user; posting goes through the workspace's publishing access.
export default async function PublishingAiPage() {
  const principal = await requireOpenServicePrincipal("/publishing/ai");
  const canPost = Array.isArray(principal.capabilities) && principal.capabilities.includes("publishing.view");
  const publishingToken = canPost ? await createPublishingIdentityToken(principal).catch(() => "") : "";

  return (
    <div className={styles.app}>
      <PublishingMenu active="ai" showWorkboard={canPost} />
      <main className={styles.content}>
        <SocialSeoWorkspace canGenerate workspaceName={principal.businessName || ""} canPost={Boolean(publishingToken)} publishingToken={publishingToken} />
      </main>
    </div>
  );
}
