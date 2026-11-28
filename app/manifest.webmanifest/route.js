// PWA manifest: makes the AgenticThat workspace installable on phones and desktop.
export function GET() {
  const manifest = {
    name: "AgenticThat",
    short_name: "AgenticThat",
    description: "Your agentic workspace for messaging, publishing and social.",
    start_url: "/apps",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#111827",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
  return Response.json(manifest, {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
