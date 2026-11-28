// The platform's own logo (from /public), for lists and badges. Unknown
// platforms show their first letter in a neutral circle.
const LOGOS = {
  instagram: "/instagram-logo.svg",
  facebook: "/facebook-logo.svg",
  messenger: "/messenger-logo.svg",
  linkedin: "/linkedin-logo.png",
  x: "/x-logo.svg",
  twitter: "/x-logo.svg",
  youtube: "/youtube-logo.svg",
  reddit: "/reddit-logo.svg",
  whatsapp: "/whatsapp-logo.svg",
  telegram: "/telegram-logo.svg",
  discord: "/discord-logo.svg",
  google: "/google-logo.svg",
  google_maps: "/google-maps-logo.svg",
  "google-maps": "/google-maps-logo.svg",
};

export function platformLogoSrc(platform) {
  return LOGOS[String(platform || "").toLowerCase()] || "";
}

export default function PlatformLogo({ platform, label = "", size = 18, className = "" }) {
  const src = platformLogoSrc(platform);
  if (!src) {
    return (
      <span className={className} aria-hidden="true" style={{ display: "inline-grid", width: size, height: size, placeItems: "center", borderRadius: "50%", background: "#e5e7eb", color: "#374151", fontSize: Math.round(size * 0.55), fontWeight: 800, flex: "0 0 auto" }}>
        {String(label || platform || "?").charAt(0).toUpperCase()}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={src} alt={label ? `${label} logo` : ""} width={size} height={size} style={{ width: size, height: size, objectFit: "contain", flex: "0 0 auto" }} loading="lazy" />;
}
