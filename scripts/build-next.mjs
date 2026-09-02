import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const projectRoot = process.cwd();
const nextEnvPath = path.join(projectRoot, "next-env.d.ts");

function canonicalNextEnv() {
  let eol = os.EOL;
  if (existsSync(nextEnvPath)) {
    const current = readFileSync(nextEnvPath, "utf8");
    if (current.includes("\r\n")) eol = "\r\n";
  }

  return [
    '/// <reference types="next" />',
    '/// <reference types="next/image-types/global" />',
    '/// <reference path="./.next/types/routes.d.ts" />',
    "",
    "// NOTE: This file should not be edited",
    "// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.",
    "",
  ].join(eol);
}

function restoreCanonicalNextEnv() {
  if (!existsSync(nextEnvPath)) return;
  const current = readFileSync(nextEnvPath, "utf8");
  if (!current.includes("AgenticThat/next-build")) return;
  writeFileSync(nextEnvPath, canonicalNextEnv(), "utf8");
}

function removeTemporaryTsconfig(cache) {
  if (!cache.external) return;
  const configPath = path.resolve(projectRoot, cache.tsconfigPath);
  if (existsSync(configPath)) unlinkSync(configPath);
}

function portablePath(value) {
  return value.split(path.sep).join("/");
}

function buildCache() {
  if (process.env.NEXT_DIST_DIR) {
    return {
      distDir: process.env.NEXT_DIST_DIR,
      tsconfigPath: process.env.NEXT_DEV_TSCONFIG || "tsconfig.json",
      external: false,
    };
  }

  if (process.platform !== "win32") {
    return { distDir: ".next", tsconfigPath: "tsconfig.json", external: false };
  }

  const projectKey = createHash("sha256")
    .update(projectRoot.toLowerCase())
    .digest("hex")
    .slice(0, 12);
  const cacheRoot = path.join(process.env.LOCALAPPDATA || os.tmpdir(), "AgenticThat", "next-build", projectKey);
  // path.relative cannot produce a usable Next.js distDir across Windows
  // volumes (GitHub hosts the checkout on D: but LOCALAPPDATA on C:). CI does
  // not need the local OneDrive workaround, so keep its output in the project.
  if (path.parse(cacheRoot).root.toLowerCase() !== path.parse(projectRoot).root.toLowerCase()) {
    return { distDir: ".next", tsconfigPath: "tsconfig.json", external: false };
  }
  const distPath = path.join(cacheRoot, "dist");
  const distDir = portablePath(path.relative(projectRoot, distPath));
  const tsconfigPath = path.join(projectRoot, ".next-build.tsconfig.json");
  const nodeModulesLink = path.join(cacheRoot, "node_modules");

  mkdirSync(cacheRoot, { recursive: true });
  if (!existsSync(nodeModulesLink)) {
    symlinkSync(
      path.join(projectRoot, "node_modules"),
      nodeModulesLink,
      process.platform === "win32" ? "junction" : "dir"
    );
  }

  const projectTsconfig = JSON.parse(readFileSync(path.join(projectRoot, "tsconfig.json"), "utf8"));
  const includes = Array.isArray(projectTsconfig.include)
    ? projectTsconfig.include.filter((entry) => !entry.startsWith(".next/types"))
    : [];
  includes.push(`${distDir}/types/**/*.ts`);
  writeFileSync(
    tsconfigPath,
    `${JSON.stringify({
      extends: "./tsconfig.json",
      compilerOptions: { plugins: [{ name: "next" }] },
      include: includes,
    }, null, 2)}\n`,
    "utf8"
  );

  return {
    distDir,
    tsconfigPath: portablePath(path.relative(projectRoot, tsconfigPath)),
    external: true,
    displayPath: distPath,
  };
}

const cache = buildCache();

if (cache.external) {
  console.log(`[build] Next.js output is outside OneDrive: ${cache.displayPath}`);
}

const child = spawn(process.execPath, [nextBin, "build"], {
  cwd: projectRoot,
  env: {
    ...process.env,
    NEXT_DIST_DIR: cache.distDir,
    NEXT_DEV_TSCONFIG: cache.tsconfigPath,
  },
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  restoreCanonicalNextEnv();
  removeTemporaryTsconfig(cache);
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  restoreCanonicalNextEnv();
  removeTemporaryTsconfig(cache);
  console.error(error.message);
  process.exit(1);
});
