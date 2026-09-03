import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  desktopPlatformDetails,
  linuxAutostartDesktopEntry,
  linuxAutostartFilePath,
} from "./platform-support.js";

test("desktop platform labels cover Windows, macOS, and Linux", () => {
  assert.equal(desktopPlatformDetails("win32").name, "Windows");
  assert.equal(desktopPlatformDetails("darwin").name, "macOS");
  assert.equal(desktopPlatformDetails("linux").name, "Linux");
  assert.equal(desktopPlatformDetails("linux").updateMode, "system");
});

test("Linux autostart uses XDG configuration when provided", () => {
  assert.equal(
    linuxAutostartFilePath({ xdgConfigHome: "/var/tmp/agentic config", homeDirectory: "/home/user" }),
    "/var/tmp/agentic config/autostart/agenticthat-companion.desktop",
  );
});

test("Linux autostart safely quotes executable paths and Desktop Entry field codes", () => {
  const entry = linuxAutostartDesktopEntry({
    executablePath: "/opt/AgenticThat 100%/agenticthat-companion",
    iconPath: "/opt/AgenticThat 100%/icon.png",
  });
  assert.match(entry, /Exec="\/opt\/AgenticThat 100%%\/agenticthat-companion" --hidden/);
  assert.match(entry, /Icon=\/opt\/AgenticThat 100%\/icon\.png/);
  assert.match(entry, /X-GNOME-Autostart-enabled=true/);
});
