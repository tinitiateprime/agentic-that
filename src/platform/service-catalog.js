export const serviceEndpoints = {
  configManager: {
    name: "Config Manager",
    consoleUrl: "/config-manager",
  },
  contentManager: {
    name: "Content Manager",
    consoleUrl: "/content-manager",
  },
  telegram: {
    name: "Telegram",
    dashboardUrl: process.env.NEXT_PUBLIC_TELEGRAM_DASHBOARD_URL || "/console",
  },
  whatsapp: {
    name: "WhatsApp",
    dashboardUrl: process.env.NEXT_PUBLIC_WHATSAPP_DASHBOARD_URL || "/dashboard",
  },
  instagramScraper: {
    name: "Instagram Scraper",
    consoleUrl: "/scraper/instagram",
  },
  publishQueue: {
    name: "Publish Queue Runner",
    consoleUrl: "/publishing",
  },
};
