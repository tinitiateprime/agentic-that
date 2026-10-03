import { notFound } from "next/navigation";
import WebsiteAssistantFrame from "@platform/website-studio/WebsiteAssistantFrame";
import { getWebsitePreview } from "@platform/server/website-studio-store";

export const dynamic = "force-dynamic";

export default async function WebsitePreviewLayout({ children, params }) {
  const { token, theme } = await params;
  try {
    const preview = await getWebsitePreview(token, theme);
    return <WebsiteAssistantFrame project={preview.project} theme={preview.theme} previewToken={preview.token}>{children}</WebsiteAssistantFrame>;
  } catch (error) {
    if (error?.status === 404) notFound();
    throw error;
  }
}
