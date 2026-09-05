const releaseRepository = process.env.COMPANION_RELEASE_REPOSITORY?.trim() || "tinitiateprime/agentic-that";
const releaseApiBase = `https://api.github.com/repos/${releaseRepository}/releases`;
const releasePageUrl = `https://github.com/${releaseRepository}/releases/latest`;
const releaseCacheSeconds = Number(process.env.COMPANION_RELEASE_CACHE_SECONDS || 900);
// Pin a specific tag (for example v2.1.12-qa.1) to stop tracking the newest published build.
const pinnedReleaseTag = process.env.COMPANION_RELEASE_TAG?.trim() || "";

const platformCatalog = [
  {
    id: "windows",
    name: "Windows",
    tagline: "Windows 10 and 11",
    architectures: [{ id: "x64", label: "64-bit (x64)", shortLabel: "x64" }],
    downloads: [
      {
        id: "windows-x64-setup",
        architecture: "x64",
        format: "EXE",
        label: "Installer",
        asset: "AgenticThat-Publishing-Companion-Setup.exe",
        detail: "Installs Companion, starts it with Windows, and keeps it updated automatically.",
        primary: true,
      },
      {
        id: "windows-x64-portable",
        architecture: "x64",
        format: "ZIP",
        label: "Portable build",
        asset: "AgenticThat-Publishing-Companion-Windows-x64-Portable.zip",
        detail: "Unzip and run without installing. Updates must be downloaded manually.",
      },
    ],
    steps: [
      "Run the installer and allow Windows SmartScreen to continue if it appears.",
      "Companion opens on http://127.0.0.1:8792 and starts with Windows from then on.",
    ],
  },
  {
    id: "macos",
    name: "macOS",
    tagline: "Intel and Apple Silicon",
    architectures: [{ id: "universal", label: "Universal (Intel + Apple Silicon)", shortLabel: "Universal" }],
    downloads: [
      {
        id: "macos-universal-dmg",
        architecture: "universal",
        format: "DMG",
        label: "Disk image",
        asset: "AgenticThat-Publishing-Companion-macOS-universal.dmg",
        detail: "One universal build for every Mac. Production releases are signed and notarized.",
        primary: true,
      },
      {
        id: "macos-universal-zip",
        architecture: "universal",
        format: "ZIP",
        label: "Portable build",
        asset: "AgenticThat-Publishing-Companion-darwin-universal.zip",
        detail: "Unzip and move AgenticThat Companion.app anywhere you like.",
      },
    ],
    steps: [
      "Open the disk image and drag AgenticThat Companion into Applications.",
      "Launch it once from Applications so macOS records the app as trusted.",
    ],
  },
  {
    id: "linux",
    name: "Linux",
    tagline: "Debian, Ubuntu, Fedora and RHEL",
    architectures: [
      { id: "x64", label: "64-bit (x64)", shortLabel: "x64" },
      { id: "arm64", label: "ARM64 (aarch64)", shortLabel: "ARM64" },
    ],
    downloads: [
      {
        id: "linux-x64-deb",
        architecture: "x64",
        format: "DEB",
        label: "Debian / Ubuntu package",
        asset: "AgenticThat-Publishing-Companion-Linux-x64.deb",
        detail: "Install with sudo apt install ./<file>.deb.",
        primary: true,
      },
      {
        id: "linux-x64-rpm",
        architecture: "x64",
        format: "RPM",
        label: "Fedora / RHEL package",
        asset: "AgenticThat-Publishing-Companion-Linux-x64.rpm",
        detail: "Install with sudo dnf install ./<file>.rpm.",
      },
      {
        id: "linux-x64-zip",
        architecture: "x64",
        format: "ZIP",
        label: "Portable build",
        asset: "AgenticThat-Publishing-Companion-Linux-x64.zip",
        detail: "Unpack anywhere and run the agenticthat-companion binary.",
      },
      {
        id: "linux-arm64-deb",
        architecture: "arm64",
        format: "DEB",
        label: "Debian / Ubuntu package",
        asset: "AgenticThat-Publishing-Companion-Linux-arm64.deb",
        detail: "Install with sudo apt install ./<file>.deb.",
        primary: true,
      },
      {
        id: "linux-arm64-rpm",
        architecture: "arm64",
        format: "RPM",
        label: "Fedora / RHEL package",
        asset: "AgenticThat-Publishing-Companion-Linux-arm64.rpm",
        detail: "Install with sudo dnf install ./<file>.rpm.",
      },
      {
        id: "linux-arm64-zip",
        architecture: "arm64",
        format: "ZIP",
        label: "Portable build",
        asset: "AgenticThat-Publishing-Companion-Linux-arm64.zip",
        detail: "Unpack anywhere and run the agenticthat-companion binary.",
      },
    ],
    steps: [
      "Install the package for your distribution, then launch AgenticThat Companion.",
      "Enable GNOME Keyring/libsecret or KWallet so local credentials stay encrypted.",
    ],
  },
];

async function requestGithub(path) {
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.COMPANION_RELEASE_TOKEN?.trim();
  try {
    const response = await fetch(`${releaseApiBase}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "AgenticThat-Companion-Downloads",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      next: { revalidate: releaseCacheSeconds },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function publishedTime(release) {
  const value = Date.parse(release?.published_at || release?.created_at || "");
  return Number.isNaN(value) ? 0 : value;
}

/**
 * Resolves the newest published Companion build. GitHub's `releases/latest` endpoint
 * skips pre-releases, so QA tags such as v2.1.12-qa.1 are only found by listing releases.
 */
async function fetchLatestRelease() {
  if (pinnedReleaseTag) {
    return await requestGithub(`/tags/${encodeURIComponent(pinnedReleaseTag)}`) || await requestGithub("/latest");
  }
  const releases = await requestGithub("?per_page=30");
  const published = Array.isArray(releases) ? releases.filter(release => release && !release.draft) : [];
  if (published.length === 0) return await requestGithub("/latest");
  return published.reduce((newest, release) => (publishedTime(release) > publishedTime(newest) ? release : newest));
}

/** Formatted on the server with a fixed locale so the markup hydrates identically. */
function publishedLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" }).format(date);
}

function assetIndex(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  return new Map(assets.map(asset => [asset.name, asset]));
}

function resolveDownload(download, assets, downloadBase) {
  const asset = assets.get(download.asset);
  return {
    id: download.id,
    architecture: download.architecture,
    format: download.format,
    label: download.label,
    detail: download.detail,
    primary: Boolean(download.primary),
    fileName: download.asset,
    href: asset?.browser_download_url || `${downloadBase}/${download.asset}`,
    sizeBytes: Number.isFinite(asset?.size) ? asset.size : null,
    available: Boolean(asset),
  };
}

/**
 * Resolves the published Companion artifacts for every supported operating system.
 * Falls back to the stable `releases/latest/download` aliases when GitHub is unreachable.
 */
export async function getCompanionRelease() {
  const release = await fetchLatestRelease();
  const assets = assetIndex(release);
  const tagName = typeof release?.tag_name === "string" ? release.tag_name : "";
  const downloadBase = tagName
    ? `https://github.com/${releaseRepository}/releases/download/${encodeURIComponent(tagName)}`
    : `https://github.com/${releaseRepository}/releases/latest/download`;

  return {
    source: release ? "github" : "fallback",
    repository: releaseRepository,
    tagName,
    version: tagName.replace(/^v/, ""),
    publishedLabel: publishedLabel(release?.published_at),
    prerelease: Boolean(release?.prerelease),
    releasePageUrl: typeof release?.html_url === "string" ? release.html_url : releasePageUrl,
    checksumsUrl: assets.get("SHA256SUMS.txt")?.browser_download_url || `${downloadBase}/SHA256SUMS.txt`,
    platforms: platformCatalog.map(platform => ({
      id: platform.id,
      name: platform.name,
      tagline: platform.tagline,
      architectures: platform.architectures,
      steps: platform.steps,
      downloads: platform.downloads.map(download => resolveDownload(download, assets, downloadBase)),
    })),
  };
}
