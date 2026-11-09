import { PRIVATE_PATHS, PUBLIC_EXCEPTIONS, SITE_URL } from "@platform/site-config";

export default function robots() {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", ...PUBLIC_EXCEPTIONS],
        disallow: PRIVATE_PATHS,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
