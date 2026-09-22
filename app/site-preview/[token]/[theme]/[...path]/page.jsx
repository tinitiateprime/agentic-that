import { notFound } from "next/navigation";
import GeneratedWebsite, { websiteRouteExists } from "@platform/website-studio/GeneratedWebsite";
import { getWebsitePreview } from "@platform/server/website-studio-store";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Private website preview | AgenticThat",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function WebsitePreviewSubpage({ params }) {
  const { token, theme, path } = await params;
  try {
    const preview = await getWebsitePreview(token, theme);
    if (!websiteRouteExists(preview.project, path)) notFound();
    return <GeneratedWebsite project={preview.project} theme={preview.theme} previewToken={preview.token} route={path} />;
  } catch (error) {
    if (error?.status === 404) notFound();
    throw error;
  }
}
