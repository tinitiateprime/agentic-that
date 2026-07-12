export const serviceEndpoints = {
  telegram: {
    name: "Telegram",
    dashboardUrl: import.meta.env.VITE_TELEGRAM_DASHBOARD_URL || (import.meta.env.DEV ? "http://127.0.0.1:8787/console" : "/console"),
  },
  instagramScraper: {
    name: "Instagram Scraper",
    consoleUrl: "/scraper/instagram",
  },
};
