import { notFound } from "next/navigation";
import GeneratedWebsite, { websiteRouteExists } from "@platform/website-studio/GeneratedWebsite";
import { getPublishedWebsite } from "@platform/server/website-studio-store";

export const dynamic = "force-dynamic";

function serviceForPath(project, path) {
  if (path?.[0] !== "services" || !path?.[1]) return null;
  return project.siteSpec.services.find((service) => service.slug === path[1]) || null;
}

export async function generateMetadata({ params }) {
  const { slug, path } = await params;
  try {
    const project = await getPublishedWebsite(slug);
    if (!websiteRouteExists(project, path)) return { title: "Website page not found" };
    const service = serviceForPath(project, path);
    const pageName = service?.name || (path?.[0] === "services" ? "Services" : path?.[0] === "about" ? "About" : path?.[0] === "contact" ? "Contact" : "");
    return {
      title: pageName ? `${pageName} | ${project.businessName}` : project.siteSpec.seo.title,
      description: service?.summary || project.siteSpec.seo.description,
      robots: { index: true, follow: true },
      openGraph: {
        title: pageName ? `${pageName} | ${project.businessName}` : project.siteSpec.seo.title,
        description: service?.summary || project.siteSpec.seo.description,
        type: "website",
        ...(project.siteSpec.media?.services?.[service?.slug]?.src || project.siteSpec.media?.hero?.src
          ? { images: [{ url: project.siteSpec.media?.services?.[service?.slug]?.src || project.siteSpec.media.hero.src }] }
          : {}),
      },
    };
  } catch {
    return { title: "Website not found" };
  }
}

export default async function PublishedWebsiteSubpage({ params }) {
  const { slug, path } = await params;
  try {
    const project = await getPublishedWebsite(slug);
    if (!websiteRouteExists(project, path)) notFound();
    return <GeneratedWebsite project={project} theme={project.selectedTheme} route={path} />;
  } catch (error) {
    if (error?.status === 404) notFound();
    throw error;
  }
}
