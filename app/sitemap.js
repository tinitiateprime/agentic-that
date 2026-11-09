import { productServices, serviceDetailHref } from "@platform/product-catalog";
import { SITE_URL } from "@platform/site-config";
import { PDF_TOOLS } from "@platform/tools-catalog";

// Only public pages belong here. App pages and ready PDF tools are added automatically
// from their catalogs, so new entries appear without editing this file.
export default function sitemap() {
  const pages = [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/about`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/apps`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE_URL}/tools/pdf`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/publishing/privacy`, changeFrequency: "yearly", priority: 0.3 },
  ];

  const apps = productServices.map((service) => ({
    url: `${SITE_URL}${serviceDetailHref(service)}`,
    changeFrequency: "monthly",
    priority: service.availability === "live" ? 0.8 : 0.5,
  }));

  const pdfTools = PDF_TOOLS.filter((tool) => tool.status === "ready").map((tool) => ({
    url: `${SITE_URL}${tool.href}`,
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  return [...pages, ...apps, ...pdfTools];
}
