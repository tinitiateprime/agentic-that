const path = require("node:path");

const certificateFile = process.env.WINDOWS_CERTIFICATE_FILE;
const certificatePassword = process.env.WINDOWS_CERTIFICATE_PASSWORD;
const storePublisher = process.env.WINDOWS_MSIX_PUBLISHER?.trim();
const storeIdentityName = process.env.WINDOWS_MSIX_IDENTITY_NAME?.trim();
const storePublisherDisplayName = process.env.WINDOWS_MSIX_PUBLISHER_DISPLAY_NAME?.trim() || "AgenticThat";
if (Boolean(certificateFile) !== Boolean(certificatePassword)) {
  throw new Error("Both WINDOWS_CERTIFICATE_FILE and WINDOWS_CERTIFICATE_PASSWORD are required for Windows signing.");
}
if (Boolean(storePublisher) !== Boolean(storeIdentityName)) {
  throw new Error("Both WINDOWS_MSIX_PUBLISHER and WINDOWS_MSIX_IDENTITY_NAME are required for Microsoft Store packaging.");
}

const windowsSign = certificateFile ? {
  certificateFile,
  certificatePassword,
  timestampServer: "http://timestamp.digicert.com",
  description: "AgenticThat Publishing Companion",
  website: "https://agentic-that.netlify.app",
  continueOnError: false,
} : undefined;

module.exports = {
  packagerConfig: {
    asar: false,
    icon: path.join(__dirname, "assets", "app-icon"),
    executableName: "AgenticThat Publishing Companion",
    win32metadata: {
      CompanyName: "AgenticThat",
      FileDescription: "AgenticThat local scheduler and browser publisher",
      ProductName: "AgenticThat Publishing Companion",
      InternalName: "AgenticThatPublishingCompanion",
      OriginalFilename: "AgenticThat Publishing Companion.exe",
    },
    ...(windowsSign ? { windowsSign } : {}),
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "agenticthat_publishing_companion",
        authors: "AgenticThat",
        description: "Local scheduler and browser publisher for AgenticThat",
        setupExe: "AgenticThat-Publishing-Companion-Setup.exe",
        setupIcon: path.join(__dirname, "assets", "app-icon.ico"),
        iconUrl: "https://agentic-that.netlify.app/publishing-companion-icon.ico",
        noMsi: true,
        ...(windowsSign ? { windowsSign } : {}),
      },
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["win32"],
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
          packageDisplayName: "AgenticThat Publishing Companion",
          appDisplayName: "AgenticThat Publishing Companion",
          packageDescription: "Local scheduler and browser publisher for AgenticThat",
          packageBackgroundColor: "#123D31",
          packageMinOSVersion: "10.0.19041.0",
          packageMaxOSVersionTested: "10.0.26100.0",
        },
      },
    }] : []),
  ],
};
