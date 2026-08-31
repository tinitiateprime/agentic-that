/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(process.env.NEXT_STANDALONE === "true" ? { output: "standalone" } : {}),
  ...(process.env.NEXT_DIST_DIR
    ? { distDir: process.env.NEXT_DIST_DIR }
    : {}),
  ...(process.env.NEXT_DEV_TSCONFIG
    ? { typescript: { tsconfigPath: process.env.NEXT_DEV_TSCONFIG } }
    : {}),
  async rewrites() {
    const rewrites = [];

    const instagramTarget = process.env.INSTAGRAM_API_URL
      || (process.env.NODE_ENV === "development"
        ? `http://127.0.0.1:${Number(process.env.INSTAGRAM_SERVICE_PORT || 8791)}`
        : "");
    if (instagramTarget) {
      rewrites.push({
        source: "/api/scraping/instagram/:path*",
        destination: `${instagramTarget.replace(/\/$/, "")}/api/scraping/instagram/:path*`,
      });
    }

    const facebookTarget = process.env.FACEBOOK_API_URL
      || (process.env.NODE_ENV === "development"
        ? `http://127.0.0.1:${Number(process.env.FACEBOOK_SERVICE_PORT || 8793)}`
        : "");
    if (facebookTarget) {
      rewrites.push({
        source: "/api/scraping/facebook/:path*",
        destination: `${facebookTarget.replace(/\/$/, "")}/api/scraping/facebook/:path*`,
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

    if (telegramTarget && process.env.NODE_ENV === "development") {
      rewrites.push({
        source: "/v1/:path*",
        destination: `${telegramTarget.replace(/\/$/, "")}/v1/:path*`,
      });
    }

    const publishQueueTarget = process.env.PUBLISH_QUEUE_API_URL
      || (process.env.NODE_ENV === "development"
        ? `http://127.0.0.1:${Number(process.env.PUBLISH_QUEUE_SERVICE_PORT || 8792)}`
        : "");

    if (publishQueueTarget && process.env.NETLIFY !== "true") {
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
