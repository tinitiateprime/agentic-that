/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];

    return [
      {
        source: "/api/scraping/instagram/:path*",
        destination: "http://127.0.0.1:8791/api/scraping/instagram/:path*",
      },
    ];
  },
};

export default nextConfig;
