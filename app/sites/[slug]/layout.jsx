import { notFound } from "next/navigation";
import WebsiteAssistantFrame from "@platform/website-studio/WebsiteAssistantFrame";
import { getPublishedWebsite } from "@platform/server/website-studio-store";

export const dynamic = "force-dynamic";

export default async function PublishedWebsiteLayout({ children, params }) {
  const { slug } = await params;
  try {
    const project = await getPublishedWebsite(slug);
    return <WebsiteAssistantFrame project={project} theme={project.selectedTheme}>{children}</WebsiteAssistantFrame>;
  } catch (error) {
    if (error?.status === 404) notFound();
    throw error;
  }
}
