import path from "node:path";

const PLATFORM_DETAILS = {
  win32: {
    id: "windows",
    name: "Windows",
    autoStartLabel: "Start automatically with Windows",
    updateMode: "automatic",
  },
  darwin: {
    id: "macos",
    name: "macOS",
    autoStartLabel: "Start automatically when I log in",
    updateMode: "automatic",
  },
  linux: {
    id: "linux",
    name: "Linux",
    autoStartLabel: "Start automatically when I log in",
    updateMode: "system",
  },
};

export function desktopPlatformDetails(platform = process.platform) {
  return PLATFORM_DETAILS[platform] || {
    id: platform || "unknown",
    name: platform || "Unknown OS",
    autoStartLabel: "Start automatically when I log in",
    updateMode: "unsupported",
  };
}

function desktopEntryValue(value, { escapeFieldCodes = false } = {}) {
  return String(value || "")
    .replaceAll("%", escapeFieldCodes ? "%%" : "%")
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("`", "\\`")
    .replaceAll("$", "\\$");
}

export function linuxAutostartFilePath({ xdgConfigHome, homeDirectory }) {
  const configRoot = String(xdgConfigHome || "").trim()
    ? path.posix.resolve(String(xdgConfigHome).trim())
    : path.posix.join(path.posix.resolve(homeDirectory), ".config");
  return path.posix.join(configRoot, "autostart", "agenticthat-companion.desktop");
}

export function linuxAutostartDesktopEntry({ executablePath, iconPath }) {
  const executable = desktopEntryValue(path.posix.resolve(executablePath), { escapeFieldCodes: true });
  const icon = desktopEntryValue(path.posix.resolve(iconPath));
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Version=1.0",
    "Name=AgenticThat Companion",
    "Comment=Run AgenticThat publishing and scraping jobs securely on this computer",
    `Exec="${executable}" --hidden`,
    `Icon=${icon}`,
    "Terminal=false",
    "Categories=Network;Utility;",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}
