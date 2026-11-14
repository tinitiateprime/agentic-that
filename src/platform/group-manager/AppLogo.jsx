/** Real app logos, from /public. */
export const APPS = {
  whatsapp: { label: "WhatsApp", logo: "/whatsapp-logo.svg", color: "#25d366", kind: "messaging" },
  telegram: { label: "Telegram", logo: "/telegram-logo.svg", color: "#229ed9", kind: "messaging" },
  discord: { label: "Discord", logo: "/discord-logo.svg", color: "#5865f2", kind: "messaging" },
  x: { label: "X Lists", logo: "/x-logo.svg", color: "#171717", kind: "social" },
  reddit: { label: "Reddit Community", logo: "/reddit-logo.svg", color: "#ff4500", kind: "social" },
  linkedin: { label: "LinkedIn Group", logo: "/linkedin-logo.png", color: "#0a66c2", kind: "social" },
  facebook: { label: "Facebook Group", logo: "/facebook-logo.svg", color: "#1877f2", kind: "social" },
  instagram: { label: "Instagram group chat", logo: "/instagram-logo.svg", color: "#d62976", kind: "social" },
};

export const MESSAGING_APPS = ["whatsapp", "telegram", "discord"];
export const SOCIAL_APPS = ["x", "reddit", "linkedin", "facebook", "instagram"];

export default function AppLogo({ app, size = 22, className }) {
  const entry = APPS[app];
  if (!entry) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={entry.logo} alt="" width={size} height={size} className={className} style={{ objectFit: "contain", flex: "0 0 auto" }} />;
}
