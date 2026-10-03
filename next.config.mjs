/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ["telegram", "postgres", "@project-workspace/embedded", "@sparticuz/chromium", "playwright-core", "sharp"],
  outputFileTracingIncludes: {
    "/api/website-studio": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/website-studio/**": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
  outputFileTracingExcludes: {
    "/*": ["./data/**", "./.data/**", "./services/**/data/**"],
  },
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
      const facebookPort = Number(process.env.FACEBOOK_SERVICE_PORT || 8793);
      rewrites.push({
        source: "/api/scraping/facebook/:path*",
        destination: `http://127.0.0.1:${facebookPort}/api/scraping/facebook/:path*`,
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

    if (publishQueueTarget && process.env.SERVERLESS !== "true" && process.env.HOSTING_PROVIDER !== "aws-amplify") {
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
