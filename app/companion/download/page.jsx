import { headers } from "next/headers";
import Link from "next/link";
import { Apple, CheckCircle2, Download, ExternalLink, Laptop, Monitor, Terminal } from "lucide-react";
import styles from "./companion-download.module.css";

export const metadata = {
  title: "Download AgenticThat Companion",
  description: "Install AgenticThat Companion for Windows, macOS, or Linux.",
};

const releaseTag = process.env.NEXT_PUBLIC_PUBLISHING_COMPANION_RELEASE_TAG?.trim() || "v2.1.10-qa.1";
const releaseBase = `https://github.com/tinitiateprime/agentic-that/releases/download/${encodeURIComponent(releaseTag)}`;
const releasePage = `https://github.com/tinitiateprime/agentic-that/releases/tag/${encodeURIComponent(releaseTag)}`;

function recommendedDevice(userAgent) {
  const value = String(userAgent || "").toLowerCase();
  if (/android|iphone|ipad|mobile/.test(value)) return { platform: null, architecture: null };
  if (value.includes("windows")) return { platform: "windows", architecture: "x64" };
  if (value.includes("macintosh") || value.includes("mac os")) return { platform: "macos", architecture: "universal" };
  if (value.includes("linux") || value.includes("x11")) {
    return { platform: "linux", architecture: /aarch64|arm64/.test(value) ? "arm64" : "x64" };
  }
  return { platform: null, architecture: null };
}

export default async function CompanionDownloadPage() {
  const requestHeaders = await headers();
  const recommended = recommendedDevice(requestHeaders.get("user-agent"));
  const recommendedLinuxArchitecture = recommended.platform === "linux" ? recommended.architecture : "x64";
  const cards = [
    {
      id: "windows",
      title: "Windows",
      subtitle: "Windows 10 or 11 - x64",
      icon: <Monitor size={28} />,
      primary: `${releaseBase}/AgenticThat-Publishing-Companion-Setup.exe`,
      primaryLabel: "Download Setup",
      detail: "Installed build with automatic startup and updates.",
    },
    {
      id: "macos",
      title: "macOS",
      subtitle: "Intel and Apple Silicon - Universal",
      icon: <Apple size={28} />,
      primary: `${releaseBase}/AgenticThat-Publishing-Companion-macOS-universal.dmg`,
      primaryLabel: "Download DMG",
      detail: "One universal build for Intel and Apple Silicon Macs; production releases are signing-gated and notarized.",
      alternatives: [
        ["Portable ZIP", `${releaseBase}/AgenticThat-Publishing-Companion-darwin-universal.zip`],
      ],
    },
    {
      id: "linux",
      title: "Linux",
      subtitle: "x64 and ARM64",
      icon: <Terminal size={28} />,
      primary: `${releaseBase}/AgenticThat-Publishing-Companion-Linux-${recommendedLinuxArchitecture}.deb`,
      primaryLabel: `Download DEB ${recommendedLinuxArchitecture.toUpperCase()}`,
      detail: "DEB for Ubuntu/Debian, RPM for Fedora/RHEL, and portable ZIP builds.",
      alternatives: [
        ["RPM x64", `${releaseBase}/AgenticThat-Publishing-Companion-Linux-x64.rpm`],
        ["ZIP x64", `${releaseBase}/AgenticThat-Publishing-Companion-Linux-x64.zip`],
        ["DEB ARM64", `${releaseBase}/AgenticThat-Publishing-Companion-Linux-arm64.deb`],
        ["RPM ARM64", `${releaseBase}/AgenticThat-Publishing-Companion-Linux-arm64.rpm`],
        ["ZIP ARM64", `${releaseBase}/AgenticThat-Publishing-Companion-Linux-arm64.zip`],
      ],
    },
  ].sort((left, right) => Number(right.id === recommended.platform) - Number(left.id === recommended.platform));

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <span className={styles.mark}><Laptop size={30} /></span>
        <p className={styles.eyebrow}>DESKTOP EXECUTION ENGINE</p>
        <h1>Download AgenticThat Companion</h1>
        <p>Run publishing and scraping securely from your own Windows, macOS, or Linux computer. No browser extension, tunnel, or separate cloud runner is required.</p>
      </section>

      <section className={styles.grid} aria-label="Companion downloads">
        {cards.map(card => (
          <article className={`${styles.card} ${card.id === recommended.platform ? styles.recommended : ""}`} key={card.id}>
            {card.id === recommended.platform && <span className={styles.badge}>Recommended for this device</span>}
            <span className={styles.icon}>{card.icon}</span>
            <h2>{card.title}</h2>
            <strong>{card.subtitle}</strong>
            <p>{card.detail}</p>
            <a className={styles.primary} href={card.primary}><Download size={17} />{card.primaryLabel}</a>
            {card.alternatives && (
              <div className={styles.alternatives}>
                {card.alternatives.map(([label, href]) => <a href={href} key={label}>{label}</a>)}
              </div>
            )}
          </article>
        ))}
      </section>

      <section className={styles.requirements}>
        <h2>Before pairing</h2>
        <div><CheckCircle2 size={18} /><span>Install Google Chrome, Microsoft Edge, or Chromium.</span></div>
        <div><CheckCircle2 size={18} /><span>On Linux, enable GNOME Keyring/libsecret or KWallet for protected local credentials.</span></div>
        <div><CheckCircle2 size={18} /><span>Open Companion, then pair it from AgenticThat Connections &gt; Publishing.</span></div>
      </section>

      <nav className={styles.actions}>
        <Link href="/publishing">Return to Publishing</Link>
        <a href={releasePage}>View checksums and every release asset <ExternalLink size={14} /></a>
      </nav>
    </main>
  );
}
