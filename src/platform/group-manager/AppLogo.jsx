/** Real app logos, from /public. */
export const APPS = {
  whatsapp: { label: "WhatsApp", logo: "/whatsapp-logo.svg", color: "#25d366", kind: "messaging" },
  telegram: { label: "Telegram", logo: "/telegram-logo.svg", color: "#229ed9", kind: "messaging" },
  discord: { label: "Discord", logo: "/discord-logo.svg", color: "#5865f2", kind: "messaging" },
  messenger: { label: "Messenger", logo: "/messenger-logo.svg", color: "#0a7cff", kind: "messaging" },
  instagram: { label: "Instagram", logo: "/instagram-logo.svg", color: "#d62976", kind: "messaging" },
  x: { label: "X Lists", logo: "/x-logo.svg", color: "#171717", kind: "social" },
  reddit: { label: "Reddit Community", logo: "/reddit-logo.svg", color: "#ff4500", kind: "social" },
  linkedin: { label: "LinkedIn Group", logo: "/linkedin-logo.png", color: "#0a66c2", kind: "social" },
  facebook: { label: "Facebook Group", logo: "/facebook-logo.svg", color: "#1877f2", kind: "social" },
};

export const MESSAGING_APPS = ["whatsapp", "telegram", "discord", "messenger", "instagram"];
export const SOCIAL_APPS = ["x", "reddit", "linkedin", "facebook"];
/** Apps that log in through a window on the app's own login page (no API for groups). */
export const BROWSER_APPS = ["messenger", "instagram"];

/** The contact field each app uses: Messenger finds people by their Facebook profile. */
export function contactIdentity(contact, app) {
  return (app === "messenger" ? contact?.facebook : contact?.[app]) || "";
}

export default function AppLogo({ app, size = 22, className }) {
  const entry = APPS[app];
  if (!entry) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={entry.logo} alt="" width={size} height={size} className={className} style={{ objectFit: "contain", flex: "0 0 auto" }} />;
}
