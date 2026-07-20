/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(process.env.NEXT_DIST_DIR
    ? { distDir: process.env.NEXT_DIST_DIR }
    : {}),
  ...(process.env.NEXT_DEV_TSCONFIG
    ? { typescript: { tsconfigPath: process.env.NEXT_DEV_TSCONFIG } }
    : {}),
  async rewrites() {
    const rewrites = [];

    if (process.env.NODE_ENV === "development") {
      const instagramPort = Number(process.env.INSTAGRAM_SERVICE_PORT || 8791);
      rewrites.push({
        source: "/api/scraping/instagram/:path*",
        destination: `http://127.0.0.1:${instagramPort}/api/scraping/instagram/:path*`,
      });
    }

    const telegramTarget = process.env.TELEGRAM_API_URL
      || (process.env.NODE_ENV === "development"
        ? `http://127.0.0.1:${Number(process.env.TELEGRAM_SERVICE_PORT || process.env.SERVICE_PORT || 8787)}`
        : "");

    rewrites.push({
      source: "/api/telegram/:path*",
      destination: telegramTarget
        ? `${telegramTarget.replace(/\/$/, "")}/v1/:path*`
        : "/v1/:path*",
    });

    const publishQueueTarget = process.env.PUBLISH_QUEUE_API_URL
      || (process.env.NODE_ENV === "development"
        ? `http://127.0.0.1:${Number(process.env.PUBLISH_QUEUE_SERVICE_PORT || 8792)}`
        : "");

    if (publishQueueTarget) {
      const target = publishQueueTarget.replace(/\/$/, "");
      rewrites.push(
        {
          source: "/api/publishing/:path*",
          destination: `${target}/api/:path*`,
        },
        {
          source: "/publishing/uploads/:path*",
          destination: `${target}/uploads/:path*`,
        },
      );
    }

    return rewrites;
  },
};

export default nextConfig;
