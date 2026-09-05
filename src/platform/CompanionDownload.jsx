"use client";

import Link from "next/link";
import {
  CheckCircle2,
  Cpu,
  Download,
  ExternalLink,
  Info,
  PackageCheck,
  ShieldCheck,
} from "lucide-react";
import { FaApple, FaLinux, FaWindows } from "react-icons/fa6";
import { useEffect, useMemo, useState } from "react";
import { formatFileSize, readBrowserArchitecture, readBrowserDevice } from "./companion-device";
import { useCompanionStatus } from "./use-companion-status";
import styles from "./companion-download.module.css";

const platformIcons = { windows: FaWindows, macos: FaApple, linux: FaLinux };
const platformDeviceLabel = { windows: "Windows PC", macos: "Mac", linux: "Linux machine" };

function DownloadRow({ download, emphasis }) {
  const size = formatFileSize(download.sizeBytes);
  return (
    <a className={`${styles.download} ${emphasis ? styles.downloadPrimary : ""}`} href={download.href} download>
      <span className={styles.downloadFormat}>{download.format}</span>
      <span className={styles.downloadCopy}>
        <strong>{download.label}{size ? <em> · {size}</em> : null}</strong>
        <small>{download.detail}</small>
      </span>
      <span className={styles.downloadAction}><Download size={17} /></span>
    </a>
  );
}

function PlatformCard({ platform, architecture, onArchitectureChange, recommended }) {
  const Icon = platformIcons[platform.id];
  const downloads = platform.downloads.filter(entry => entry.architecture === architecture);

  return (
    <article className={`${styles.platform} ${recommended ? styles.platformRecommended : ""}`}>
      <header className={styles.platformHead}>
        <span className={styles.platformIcon}><Icon size={22} /></span>
        <span className={styles.platformIdentity}>
          <h3>{platform.name}</h3>
          <small>{platform.tagline}</small>
        </span>
        {recommended && <span className={styles.platformBadge}>Your device</span>}
      </header>

      {platform.architectures.length > 1 && (
        <div className={styles.architectures}>
          <span><Cpu size={14} />Architecture</span>
          {platform.architectures.map(entry => (
            <button
              aria-pressed={entry.id === architecture}
              className={entry.id === architecture ? styles.architectureActive : ""}
              key={entry.id}
              onClick={() => onArchitectureChange(entry.id)}
              type="button"
            >
              {entry.shortLabel || entry.label}
            </button>
          ))}
        </div>
      )}

      <div className={styles.downloads}>
        {downloads.map(download => (
          <DownloadRow download={download} emphasis={download.primary} key={download.id} />
        ))}
      </div>

      <ol className={styles.steps}>
        {platform.steps.map(step => <li key={step}>{step}</li>)}
      </ol>
    </article>
  );
}

export default function CompanionDownload({ release, initialDevice, signedIn = false }) {
  const platforms = release.platforms;
  const { status: companionStatus } = useCompanionStatus();
  const [device, setDevice] = useState(initialDevice);
  const [architectures, setArchitectures] = useState(() => ({
    windows: "x64",
    macos: "universal",
    linux: initialDevice.platform === "linux" ? initialDevice.architecture : "x64",
  }));

  useEffect(() => {
    let cancelled = false;
    const browserDevice = readBrowserDevice();
    if (!browserDevice.platform) return undefined;
    readBrowserArchitecture().then(architecture => {
      if (cancelled) return;
      const resolved = architecture.includes("arm") && browserDevice.platform === "linux"
        ? { ...browserDevice, architecture: "arm64" }
        : browserDevice;
      setDevice(resolved);
      setArchitectures(current => ({ ...current, [resolved.platform]: resolved.architecture }));
    });
    return () => { cancelled = true; };
  }, []);

  const recommended = useMemo(() => {
    if (!device.platform) return null;
    const target = platforms.find(entry => entry.id === device.platform);
    if (!target) return null;
    const architectureId = device.architecture || target.architectures[0].id;
    const matches = target.downloads.filter(entry => entry.architecture === architectureId);
    const download = matches.find(entry => entry.primary) || matches[0];
    return download ? { platform: target, download, alternatives: matches.filter(entry => entry !== download) } : null;
  }, [device, platforms]);

  const RecommendedIcon = recommended ? platformIcons[recommended.platform.id] : Download;
  const recommendedSize = recommended ? formatFileSize(recommended.download.sizeBytes) : "";

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Desktop execution engine</p>
          <h1>Download AgenticThat Companion</h1>
          <p className={styles.intro}>
            Companion runs publishing and scraping from your own computer, so browser sessions and credentials never
            leave your machine. Every build below comes from the same signed release — pick your operating system,
            install it, then pair it from Connections.
          </p>
        </div>
        <div className={styles.releaseMeta}>
          {release.version && <span className={styles.versionPill}><PackageCheck size={15} />Version {release.version}</span>}
          {release.prerelease && <span className={styles.prereleasePill}>Pre-release</span>}
          {release.publishedLabel && <small>Published {release.publishedLabel}</small>}
          <a className={styles.metaLink} href={release.releasePageUrl} target="_blank" rel="noreferrer">
            All release assets <ExternalLink size={13} />
          </a>
        </div>
      </header>

      {companionStatus.state === "connected" && (
        <section className={styles.installed} role="status">
          <CheckCircle2 size={18} />
          <span>
            <strong>Companion is already running on this device{companionStatus.version ? ` (version ${companionStatus.version})` : ""}.</strong>
            {" "}
            {signedIn
              ? <Link href="/config-manager?service=publishing">Pair it with this workspace</Link>
              : "Sign in and pair it from Connections › Publishing"}
            {" "}or download a build below for another computer.
          </span>
        </section>
      )}

      {recommended && (
        <section className={styles.recommended} aria-label="Recommended download">
          <span className={styles.recommendedIcon}><RecommendedIcon size={30} /></span>
          <div className={styles.recommendedCopy}>
            <span className={styles.badge}>Recommended for this device</span>
            <h2>{recommended.platform.name} · {recommended.download.label}</h2>
            <p>{recommended.download.detail}</p>
          </div>
          <div className={styles.recommendedActions}>
            <a className={styles.buttonPrimary} href={recommended.download.href} download>
              <Download size={17} />
              <span>Download for {platformDeviceLabel[recommended.platform.id]}{recommendedSize ? ` · ${recommendedSize}` : ""}</span>
            </a>
            {recommended.alternatives.length > 0 && (
              <span className={styles.recommendedAlternatives}>
                Other formats:
                {recommended.alternatives.map(entry => (
                  <a href={entry.href} key={entry.id} download>{entry.format}</a>
                ))}
              </span>
            )}
          </div>
        </section>
      )}

      <section className={styles.allPlatforms} aria-label="Companion downloads for every operating system">
        <div className={styles.sectionHead}>
          <h2>Every operating system</h2>
          <p>Windows, macOS and Linux builds of {release.version ? `version ${release.version}` : "the current release"}.</p>
        </div>
        <div className={styles.platformGrid}>
          {platforms.map(platform => (
            <PlatformCard
              architecture={architectures[platform.id] || platform.architectures[0].id}
              key={platform.id}
              onArchitectureChange={value => setArchitectures(current => ({ ...current, [platform.id]: value }))}
              platform={platform}
              recommended={platform.id === device.platform}
            />
          ))}
        </div>
      </section>

      <section className={styles.after}>
        <h2>After installing</h2>
        <div><CheckCircle2 size={18} /><span>Install Google Chrome, Microsoft Edge, or Chromium — Companion drives a real browser.</span></div>
        <div><CheckCircle2 size={18} /><span>Open Companion and leave it running while you publish or scrape.</span></div>
        <div>
          <CheckCircle2 size={18} />
          <span>
            Pair it from{" "}
            {signedIn
              ? <Link href="/config-manager?service=publishing">Connections &rsaquo; Publishing</Link>
              : "Connections › Publishing"}
            {" "}to link this workspace.
          </span>
        </div>
      </section>

      <footer className={styles.footer}>
        <span className={styles.trust}>
          <ShieldCheck size={16} />
          Every build is produced by the release workflow in the AgenticThat repository.
          <a href={release.checksumsUrl} target="_blank" rel="noreferrer">Verify SHA-256 checksums <ExternalLink size={13} /></a>
        </span>
        {release.source === "fallback" && (
          <span className={styles.notice}>
            <Info size={15} />
            Live release details are unavailable right now, so these links point at the latest published build.
          </span>
        )}
      </footer>
    </main>
  );
}
