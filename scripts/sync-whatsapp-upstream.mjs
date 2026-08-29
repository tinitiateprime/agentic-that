// Pulls new commits from the standalone WhatsApp console
// (tinitiateprime/tinitiate-wa-workflows) into this repository's vendored copy.
//
// The vendored copy is not a straight fork. Upstream's flat layout is split
// across two roots here, and every module alias is rewritten, so a plain
// `git merge` cannot be used. This script rebuilds both sides of the upstream
// change in *local* path and import space, then runs a real three-way merge
// against the working tree. Local adaptations — the RBAC auth adapter, the
// platform tenancy columns — survive as merge conflicts to resolve rather than
// as silent overwrites.
//
//   node scripts/sync-whatsapp-upstream.mjs              # report only
//   node scripts/sync-whatsapp-upstream.mjs --apply      # write merged files
//   node scripts/sync-whatsapp-upstream.mjs --set-base   # record the sync as done
//
// --set-base neither merges nor writes — a resolved file no longer matches
// either side, so re-merging it against the old base would only manufacture
// fresh conflicts. It records the new base once no conflict markers remain,
// which is the one invariant that stays checkable after the fact. Run it after
// every conflict is resolved and every review item is carried over by hand.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const apply = process.argv.includes("--apply");
const setBase = process.argv.includes("--set-base");
const targetArgument = process.argv.find((value) => value.startsWith("--target="))?.slice("--target=".length);

const upstreamFile = path.resolve("services/messaging/whatsapp/UPSTREAM.json");
const upstream = JSON.parse(readFileSync(upstreamFile, "utf8"));
const target = targetArgument || `${upstream.remote}/${upstream.branch}`;

// Upstream's flat tree maps onto two local roots. Order matters: the first
// matching prefix wins, so the relocated auth/marketing routes are listed
// before the generic `app/` passthrough.
const pathRules = [
  ["app/api/auth/", "app/api/whatsapp/auth/"],
  ["app/login/", "app/whatsapp/login/"],
  ["app/signup/", "app/whatsapp/signup/"],
  ["app/onboarding/", "app/whatsapp/onboarding/"],
  ["app/globals.css", "services/messaging/whatsapp/src/styles/whatsapp-globals.css"],
  ["lib/", "services/messaging/whatsapp/src/lib/"],
  ["components/", "services/messaging/whatsapp/src/components/"],
  ["app/", "app/"],
];

// Owned by the platform shell, not by the WhatsApp console. Upstream edits to
// these are reported so they can be judged, never merged.
const platformOwned = new Set(["app/layout.jsx", "app/page.jsx"]);

const importRules = [
  [/(["'])@\/lib\//g, "$1@whatsapp/lib/"],
  [/(["'])@\/components\//g, "$1@whatsapp/components/"],
];

const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs"]);

function git(args, options = {}) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
}

function localPathFor(upstreamPath) {
  if (platformOwned.has(upstreamPath)) return null;
  const rule = pathRules.find(([prefix]) => upstreamPath === prefix || upstreamPath.startsWith(prefix));
  if (!rule) return null;
  const [prefix, replacement] = rule;
  return upstreamPath === prefix ? replacement : replacement + upstreamPath.slice(prefix.length);
}

function adapt(text, upstreamPath) {
  if (!sourceExtensions.has(path.extname(upstreamPath))) return text;
  return importRules.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text);
}

// Returns the adapted blob at a revision, or null when the file is absent
// there (added or deleted by the range being synced).
function blobAt(revision, upstreamPath) {
  try {
    const text = git(["show", `${revision}:${upstreamPath}`], { stdio: ["ignore", "pipe", "ignore"] });
    return adapt(text, upstreamPath);
  } catch {
    return null;
  }
}

function readLocal(localPath) {
  try {
    return readFileSync(path.resolve(localPath), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

// git merge-file exits 0 on a clean merge and with the conflict count when it
// had to leave markers. Anything negative is a real failure.
function mergeFile(scratch, localText, baseText, newText) {
  const files = ["local", "base", "upstream"].map((name) => path.join(scratch, name));
  writeFileSync(files[0], localText);
  writeFileSync(files[1], baseText ?? "");
  writeFileSync(files[2], newText);
  try {
    const merged = execFileSync(
      "git",
      ["merge-file", "-p", "--diff3", "-L", "local", "-L", "upstream base", "-L", "upstream new", ...files],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    return { text: merged, conflicts: 0 };
  } catch (error) {
    if (typeof error.status === "number" && error.status > 0) {
      return { text: error.stdout, conflicts: error.status };
    }
    throw error;
  }
}

function write(localPath, text) {
  const absolute = path.resolve(localPath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, text);
}

// Route handlers reaching the platform must translate an RBAC denial into a
// 403. Freshly pulled upstream files still carry the standalone app's flat 401.
function needsAuthAdapter(text) {
  return /"Unauthorized"/.test(text) || (/getCurrentUser\(/.test(text) && !/whatsappAccessErrorResponse/.test(text));
}

const baseCommit = upstream.baseCommit;
for (const revision of [baseCommit, target]) {
  try {
    git(["rev-parse", "--verify", `${revision}^{commit}`], { stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    throw new Error(`Cannot resolve ${revision}. Run: git fetch ${upstream.remote} ${upstream.branch}`);
  }
}

const targetSha = git(["rev-parse", target]).trim();
const targetSubject = git(["log", "-1", "--format=%s", targetSha]).trim();
const baseSubject = git(["log", "-1", "--format=%s", baseCommit]).trim();

if (targetSha === git(["rev-parse", baseCommit]).trim()) {
  process.stdout.write(`Already at upstream ${targetSha.slice(0, 7)} (${targetSubject}). Nothing to sync.\n`);
  process.exit(0);
}

function recordBase() {
  const touched = git(["diff", "--name-only", "-M", baseCommit, targetSha])
    .split("\n").filter(Boolean)
    .map(localPathFor)
    .filter((localPath) => localPath && existsSync(path.resolve(localPath)));
  const unresolved = touched.filter((localPath) => /^<{7} local$/m.test(readFileSync(path.resolve(localPath), "utf8")));
  if (unresolved.length) {
    throw new Error(`Conflict markers remain in:\n  ${unresolved.join("\n  ")}`);
  }
  writeFileSync(upstreamFile, `${JSON.stringify({ ...upstream, baseCommit: targetSha, baseSubject: targetSubject }, null, 2)}\n`);
  process.stdout.write(`Base commit advanced to ${targetSha.slice(0, 7)}  ${targetSubject}\n`);
}

if (setBase) {
  recordBase();
  process.exit(0);
}

const changes = git(["diff", "--name-status", "-M", baseCommit, targetSha])
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const parts = line.split("\t");
    // Renames arrive as R100\told\tnew; the new path is what we sync.
    return { status: parts[0][0], upstreamPath: parts[parts.length - 1] };
  });

const scratch = mkdtempSync(path.join(os.tmpdir(), "wa-sync-"));
const results = [];

try {
  for (const { status, upstreamPath } of changes) {
    const localPath = localPathFor(upstreamPath);
    if (!localPath) {
      results.push({ kind: "review", upstreamPath, localPath: null, note: platformOwned.has(upstreamPath) ? "platform-owned file" : "no local counterpart" });
      continue;
    }
    if (status === "D") {
      results.push({ kind: "review", upstreamPath, localPath, note: "deleted upstream — remove by hand if unused" });
      continue;
    }

    const baseText = blobAt(baseCommit, upstreamPath);
    const newText = blobAt(targetSha, upstreamPath);
    if (newText === null) {
      results.push({ kind: "review", upstreamPath, localPath, note: "unreadable at target revision" });
      continue;
    }
    const localText = readLocal(localPath);

    if (localText === null) {
      results.push({ kind: "added", upstreamPath, localPath, text: newText });
      continue;
    }
    if (localText === newText) {
      results.push({ kind: "current", upstreamPath, localPath });
      continue;
    }
    if (localText === baseText) {
      results.push({ kind: "updated", upstreamPath, localPath, text: newText });
      continue;
    }

    const merged = mergeFile(scratch, localText, baseText, newText);
    results.push({
      kind: merged.conflicts ? "conflict" : "merged",
      upstreamPath,
      localPath,
      text: merged.text,
      conflicts: merged.conflicts,
    });
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const writable = results.filter((result) => ["added", "updated", "merged", "conflict"].includes(result.kind));
if (apply) for (const result of writable) write(result.localPath, result.text);

const order = { conflict: 0, added: 1, updated: 2, merged: 3, review: 4, current: 5 };
const label = {
  conflict: "conflict",
  added: "added",
  updated: "updated",
  merged: "merged",
  review: "review",
  current: "current",
};

process.stdout.write(
  `\nWhatsApp upstream sync\n` +
  `  remote  ${target}\n` +
  `  base    ${baseCommit.slice(0, 7)}  ${baseSubject}\n` +
  `  target  ${targetSha.slice(0, 7)}  ${targetSubject}\n` +
  `  mode    ${apply ? "apply — files written" : "report only (pass --apply to write)"}\n\n`,
);

for (const result of [...results].sort((a, b) => order[a.kind] - order[b.kind] || a.upstreamPath.localeCompare(b.upstreamPath))) {
  const destination = result.localPath || result.upstreamPath;
  const suffix = result.note ? `  — ${result.note}` : result.conflicts ? `  — ${result.conflicts} conflict block${result.conflicts === 1 ? "" : "s"}` : "";
  process.stdout.write(`  ${label[result.kind].padEnd(9)}${destination}${suffix}\n`);
}

const hardening = writable.filter((result) => result.localPath.startsWith("app/api/") && needsAuthAdapter(result.text));
if (hardening.length) {
  process.stdout.write(`\nRoute handlers to re-check against @whatsapp/lib/auth (bare 401 or missing whatsappAccessErrorResponse):\n`);
  for (const result of hardening) process.stdout.write(`  ${result.localPath}\n`);
}

const counts = results.reduce((totals, result) => ({ ...totals, [result.kind]: (totals[result.kind] || 0) + 1 }), {});
const summary = Object.entries(counts).map(([kind, count]) => `${count} ${kind}`).join(", ");
process.stdout.write(`\n${results.length} upstream file${results.length === 1 ? "" : "s"}: ${summary}\n`);

if (apply) {
  process.stdout.write(
    `\nResolve any conflict markers and carry over any review items, then record the sync:\n` +
    `  node scripts/sync-whatsapp-upstream.mjs --set-base\n` +
    `Until the base is recorded, re-running this reports the same range again — and files you\n` +
    `have already resolved will show as conflicts, since they now match neither upstream side.\n`,
  );
}
