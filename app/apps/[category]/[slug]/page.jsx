import { notFound } from "next/navigation";
import ServiceDetail from "@platform/ServiceDetail";
import {
  getProductCategory,
  getProductService,
  getServicesByCategory,
  serviceDetailHref,
} from "@platform/product-catalog";
import { accessResourceForService } from "@platform/access-catalog";
import { getCurrentPrincipal, requireAccess, requireCapability } from "@platform/server/access-control";
import { OG_IMAGE, SITE_NAME, SITE_URL } from "@platform/site-config";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { category, slug } = await params;
  const service = getProductService(category, slug);
  if (!service) return { title: "App not found — AgenticThat" };
  const path = serviceDetailHref(service);
  return {
    title: `${service.name} — AgenticThat`,
    description: service.shortDescription,
    alternates: { canonical: path },
    openGraph: {
      title: `${service.name} — AgenticThat`,
      description: service.shortDescription,
      url: `${SITE_URL}${path}`,
      siteName: SITE_NAME,
      type: "website",
      images: [OG_IMAGE],
    },
  };
}

function structuredDataFor(service, category) {
  const url = `${SITE_URL}${serviceDetailHref(service)}`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        "@id": `${url}#app`,
        name: `${SITE_NAME} ${service.name}`,
        url,
        description: service.shortDescription,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: category.label,
        operatingSystem: "Web",
        publisher: { "@id": `${SITE_URL}/#organization` },
        ...(Array.isArray(service.outcomes) && service.outcomes.length ? { featureList: service.outcomes } : {}),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
          { "@type": "ListItem", position: 2, name: "Store", item: `${SITE_URL}/apps` },
          { "@type": "ListItem", position: 3, name: service.name, item: url },
        ],
      },
    ],
  };
}

// Public: visitors who are not signed in see the full app page with sign-up actions.
// Signed-in users keep the existing access and capability checks.
export default async function AppDetailPage({ params }) {
  const { category: categoryId, slug } = await params;
  const service = getProductService(categoryId, slug);
  const category = getProductCategory(categoryId);
  if (!service || !category) notFound();

  let user = null;
  if (await getCurrentPrincipal()) {
    user = await requireAccess(accessResourceForService(service), "view", `/apps/${categoryId}/${slug}`);
    if (service.availability === "live" && ["messaging", "publishing", "scraping"].includes(categoryId)) {
      user = await requireCapability(`${categoryId}.view`, `/apps/${categoryId}/${slug}`);
    }
  }

  const related = getServicesByCategory(categoryId)
    .filter((candidate) => candidate.slug !== slug)
    .slice(0, 3);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredDataFor(service, category)).replace(/</g, "\\u003c") }}
      />
      <ServiceDetail
        user={user ? { id: user.userId, name: user.name, email: user.email, businessName: user.businessName, isGlobalAdmin: user.isGlobalAdmin, billingStatus: user.billingStatus, trialStartsAt: user.trialStartsAt, trialEndsAt: user.trialEndsAt, capabilities: user.capabilities } : null}
        accessLevel={user ? user.access[accessResourceForService(service)] : undefined}
        service={service}
        category={category}
        related={related}
      />
    </>
  );
}
