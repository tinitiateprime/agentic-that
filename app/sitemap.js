import { SITE_URL } from "@platform/site-config";
import { PDF_TOOLS } from "@platform/tools-catalog";

// Only public pages belong here. Ready PDF tools are added from their catalog,
// so new tools appear without editing this file. The Store (/apps) needs a login,
// so it is not listed.
export default function sitemap() {
  const pages = [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/about`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/tools/pdf`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/publishing/privacy`, changeFrequency: "yearly", priority: 0.3 },
  ];

  const pdfTools = PDF_TOOLS.filter((tool) => tool.status === "ready").map((tool) => ({
    url: `${SITE_URL}${tool.href}`,
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  return [...pages, ...pdfTools];
}
