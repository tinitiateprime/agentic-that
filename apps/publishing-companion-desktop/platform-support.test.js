import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("desktop host configures the identity variable consumed by its embedded service", async () => {
  const [mainSource, identitySource] = await Promise.all([
    readFile(new URL("./main.js", import.meta.url), "utf8"),
    readFile(new URL("../../services/publishing/queue-runner/server/companion-identity.ts", import.meta.url), "utf8"),
  ]);
  const identityVariable = identitySource.match(/process\.env\.([A-Z_]+)\?\.trim\(\)/)?.[1];
  assert.ok(identityVariable, "embedded service identity environment variable was not found");
  assert.match(mainSource, new RegExp(`process\\.env\\.${identityVariable}\\s*=\\s*settings\\.instanceId`));
});

test("desktop scrapers use isolated public compositor-visible workers", async () => {
  const mainSource = await readFile(new URL("./main.js", import.meta.url), "utf8");
  assert.match(mainSource, /agenticthat-instagram-scrape-\$\{id\}/);
  assert.match(mainSource, /agenticthat-facebook-scrape-\$\{id\}/);
  assert.match(mainSource, /workerWindow\.showInactive\(\)/);
  assert.match(mainSource, /opacity:\s*0/);
});
