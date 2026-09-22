import { notFound } from "next/navigation";
import GeneratedWebsite from "@platform/website-studio/GeneratedWebsite";
import { getWebsitePreview } from "@platform/server/website-studio-store";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Private website preview | AgenticThat",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function WebsitePreviewPage({ params }) {
  const { token, theme } = await params;
  try {
    const preview = await getWebsitePreview(token, theme);
    return <GeneratedWebsite project={preview.project} theme={preview.theme} previewToken={preview.token} />;
  } catch (error) {
    if (error?.status === 404) notFound();
    throw error;
  }
}
