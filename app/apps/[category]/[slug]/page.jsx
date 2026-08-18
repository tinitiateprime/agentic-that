import { notFound, redirect } from "next/navigation";
import ServiceDetail from "@platform/ServiceDetail";
import {
  getProductCategory,
  getProductService,
  getServicesByCategory,
} from "@platform/product-catalog";
import { accessResourceForService } from "@platform/access-catalog";
import { requireAccess, requireCapability } from "@platform/server/access-control";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { category, slug } = await params;
  const service = getProductService(category, slug);
  if (!service) return { title: "App not found — AgenticThat" };
  return {
    title: `${service.name} — AgenticThat Apps`,
    description: service.shortDescription,
  };
}

export default async function AppDetailPage({ params }) {
  const { category: categoryId, slug } = await params;
  const service = getProductService(categoryId, slug);
  const category = getProductCategory(categoryId);
  if (!service || !category) notFound();

  let user = await requireAccess(accessResourceForService(service), "view", `/apps/${categoryId}/${slug}`);
  if (service.availability === "live" && ["messaging", "publishing", "scraping"].includes(categoryId)) {
    user = await requireCapability(`${categoryId}.view`, `/apps/${categoryId}/${slug}`);
  }

  const related = getServicesByCategory(categoryId)
    .filter((candidate) => candidate.slug !== slug)
    .slice(0, 3);

  return (
    <ServiceDetail
      user={{ id: user.userId, name: user.name, email: user.email, businessName: user.businessName, isGlobalAdmin: user.isGlobalAdmin, billingStatus: user.billingStatus, trialStartsAt: user.trialStartsAt, trialEndsAt: user.trialEndsAt, capabilities: user.capabilities }}
      accessLevel={user.access[accessResourceForService(service)]}
      service={service}
      category={category}
      related={related}
    />
  );
}
