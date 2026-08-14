import "@fontsource/roboto/latin-400.css";
import "@fontsource/roboto/latin-500.css";
import "../src/styles/globals.css";
import "../services/messaging/whatsapp/src/styles/whatsapp-globals.css";
import "../src/platform/platform-home.css";
import "../services/scraping/instagram/console/src/instagram-scraper.css";
import "../services/scraping/facebook/console/src/facebook-scraper.css";

export const metadata = {
  title: "AgenticThat",
  description: "Deploy intelligent agents for scraping, publishing, and messaging automation.",
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
