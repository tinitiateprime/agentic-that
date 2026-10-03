import { notFound } from "next/navigation";
import GeneratedWebsite from "@platform/website-studio/GeneratedWebsite";
import { getPublishedWebsite } from "@platform/server/website-studio-store";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { slug } = await params;
  try {
    const project = await getPublishedWebsite(slug);
    return {
      title: project.siteSpec.seo.title,
      description: project.siteSpec.seo.description,
      robots: { index: true, follow: true },
      openGraph: {
        title: project.siteSpec.seo.title,
        description: project.siteSpec.seo.description,
        type: "website",
        ...(project.siteSpec.media?.hero?.src || project.businessProfile.heroImage
          ? { images: [{ url: project.siteSpec.media?.hero?.src || project.businessProfile.heroImage }] }
          : {}),
      },
    };
  } catch {
    return { title: "Website not found" };
  }
}
export default async function PublishedWebsitePage({ params }) {
  const { slug } = await params;
  try {
    const project = await getPublishedWebsite(slug);
    return <GeneratedWebsite project={project} theme={project.selectedTheme} />;
  } catch (error) {
    if (error?.status === 404) notFound();
    throw error;
  }
}
