const path = require("node:path");

const certificateFile = process.env.WINDOWS_CERTIFICATE_FILE;
const certificatePassword = process.env.WINDOWS_CERTIFICATE_PASSWORD;

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
        ...(certificateFile ? { certificateFile, certificatePassword } : {}),
      },
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["win32"],
    },
  ],
};
