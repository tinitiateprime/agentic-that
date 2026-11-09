import "@fontsource/roboto/latin-400.css";
import "@fontsource/roboto/latin-500.css";
import "../src/styles/globals.css";
import "../services/messaging/whatsapp/src/styles/whatsapp-globals.css";
import "../src/platform/platform-home.css";
import "../services/scraping/instagram/console/src/instagram-scraper.css";
import "../services/scraping/facebook/console/src/facebook-scraper.css";

import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from "@platform/site-config";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f7faf8",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen text-slate-800 antialiased">{children}</body>
    </html>
  );
}
