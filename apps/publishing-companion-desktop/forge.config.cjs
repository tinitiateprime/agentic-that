const path = require("node:path");

const hostPlatform = process.platform;
const isWindows = hostPlatform === "win32";
const isMac = hostPlatform === "darwin";

const certificateFile = process.env.WINDOWS_CERTIFICATE_FILE;
const certificatePassword = process.env.WINDOWS_CERTIFICATE_PASSWORD;
const storePublisher = process.env.WINDOWS_MSIX_PUBLISHER?.trim();
const storeIdentityName = process.env.WINDOWS_MSIX_IDENTITY_NAME?.trim();
const storePublisherDisplayName = process.env.WINDOWS_MSIX_PUBLISHER_DISPLAY_NAME?.trim() || "AgenticThat";
const macSigningIdentity = process.env.MACOS_SIGNING_IDENTITY?.trim();
const appleApiKey = process.env.APPLE_API_KEY_PATH?.trim();
const appleApiKeyId = process.env.APPLE_API_KEY_ID?.trim();
const appleApiIssuer = process.env.APPLE_API_ISSUER?.trim();
if (Boolean(certificateFile) !== Boolean(certificatePassword)) {
  throw new Error("Both WINDOWS_CERTIFICATE_FILE and WINDOWS_CERTIFICATE_PASSWORD are required for Windows signing.");
}
if (Boolean(storePublisher) !== Boolean(storeIdentityName)) {
  throw new Error("Both WINDOWS_MSIX_PUBLISHER and WINDOWS_MSIX_IDENTITY_NAME are required for Microsoft Store packaging.");
}
if ([appleApiKey, appleApiKeyId, appleApiIssuer].filter(Boolean).length > 0
  && ![appleApiKey, appleApiKeyId, appleApiIssuer].every(Boolean)) {
  throw new Error("APPLE_API_KEY_PATH, APPLE_API_KEY_ID, and APPLE_API_ISSUER are all required for macOS notarization.");
}

const windowsSign = certificateFile ? {
  certificateFile,
  certificatePassword,
  timestampServer: "http://timestamp.digicert.com",
  description: "AgenticThat Companion",
  website: "https://agentic-that.netlify.app",
  continueOnError: false,
} : undefined;
const macSign = isMac && macSigningIdentity ? {
  identity: macSigningIdentity,
  hardenedRuntime: true,
} : undefined;
const macNotarize = isMac && appleApiKey ? {
  appleApiKey,
  appleApiKeyId,
  appleApiIssuer,
} : undefined;
const executableName = isWindows ? "AgenticThat Publishing Companion" : "agenticthat-companion";
const platformIcon = isWindows
  ? path.join(__dirname, "assets", "app-icon.ico")
  : isMac
    ? path.join(__dirname, "assets", "app-icon.icns")
    : path.join(__dirname, "assets", "app-icon-1024.png");

module.exports = {
  packagerConfig: {
    asar: false,
    icon: platformIcon,
    executableName,
    appBundleId: "com.agenticthat.companion",
    appCategoryType: "public.app-category.productivity",
    win32metadata: {
      CompanyName: "AgenticThat",
      FileDescription: "AgenticThat local publishing, account-session, and scraping Companion",
      ProductName: "AgenticThat Companion",
      InternalName: "AgenticThatPublishingCompanion",
      OriginalFilename: "AgenticThat Publishing Companion.exe",
    },
    ...(windowsSign ? { windowsSign } : {}),
    ...(macSign ? { osxSign: macSign } : {}),
    ...(macNotarize ? { osxNotarize: macNotarize } : {}),
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "agenticthat_publishing_companion",
        authors: "AgenticThat",
        description: "Local publishing, account-session, and scraping Companion for AgenticThat",
        setupExe: "AgenticThat-Publishing-Companion-Setup.exe",
        setupIcon: path.join(__dirname, "assets", "app-icon.ico"),
        iconUrl: "https://agentic-that.netlify.app/publishing-companion-icon.ico",
        noMsi: true,
        ...(windowsSign ? { windowsSign } : {}),
      },
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["win32", "darwin", "linux"],
    },
    {
      name: "@electron-forge/maker-dmg",
      platforms: ["darwin"],
      config: {
        name: "AgenticThat Companion",
        icon: platformIcon,
        format: "UDZO",
      },
    },
    {
      name: "@electron-forge/maker-deb",
      platforms: ["linux"],
      config: {
        options: {
          name: "agenticthat-companion",
          productName: "AgenticThat Companion",
          genericName: "Social publishing companion",
          description: "Secure local execution engine for AgenticThat publishing and scraping",
          productDescription: "Runs AgenticThat publishing and Instagram/Facebook scraping jobs locally with protected browser sessions.",
          maintainer: "AgenticThat",
          homepage: "https://agentic-that.netlify.app",
          categories: ["Network", "Utility"],
          icon: path.join(__dirname, "assets", "app-icon-1024.png"),
          bin: executableName,
          recommends: ["libsecret-1-0", "gnome-keyring", "google-chrome-stable | chromium | chromium-browser"],
        },
      },
    },
    {
      name: "@electron-forge/maker-rpm",
      platforms: ["linux"],
      config: {
        options: {
          name: "agenticthat-companion",
          productName: "AgenticThat Companion",
          genericName: "Social publishing companion",
          description: "Secure local execution engine for AgenticThat publishing and scraping",
          productDescription: "Runs AgenticThat publishing and Instagram/Facebook scraping jobs locally with protected browser sessions.",
          license: "UNLICENSED",
          homepage: "https://agentic-that.netlify.app",
          categories: ["Network", "Utility"],
          icon: path.join(__dirname, "assets", "app-icon-1024.png"),
          bin: executableName,
          requires: ["libsecret"],
        },
      },
    },
    ...(storePublisher ? [{
      name: "@electron-forge/maker-msix",
      config: {
        sign: false,
        packageName: "AgenticThat-Publishing-Companion-Store.msix",
        packageAssets: path.join(__dirname, "assets", "msix"),
        ...(process.env.WINDOWS_KIT_VERSION ? { windowsKitVersion: process.env.WINDOWS_KIT_VERSION } : {}),
        manifestVariables: {
          publisher: storePublisher,
          publisherDisplayName: storePublisherDisplayName,
          packageIdentity: storeIdentityName,
          packageDisplayName: "AgenticThat Companion",
          appDisplayName: "AgenticThat Companion",
          packageDescription: "Local publishing, account-session, and scraping Companion for AgenticThat",
          packageBackgroundColor: "#123D31",
          packageMinOSVersion: "10.0.19041.0",
          packageMaxOSVersionTested: "10.0.26100.0",
        },
      },
    }] : []),
  ],
};
