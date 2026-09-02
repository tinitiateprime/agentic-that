const fs = require("node:fs");
const path = require("node:path");

const target = path.join(__dirname, "..", "node_modules", "@electron-forge", "core", "dist", "api", "package.js");
const source = fs.readFileSync(target, "utf8");
const marker = "AGENTICTHAT_PACKAGER_V20_PROMISE_HOOKS_V2";
if (source.includes(marker)) process.exit(0);

const start = source.indexOf("function sequentialHooks(hooks) {");
const end = source.indexOf("const listrPackage =", start);
if (start < 0 || end < 0) {
  throw new Error("Electron Forge packaging hook layout changed; remove the compatibility patch and verify the new Forge release.");
}

const replacement = `// ${marker}
function sequentialHooks(hooks) {
    return [
        async ({ buildPath, electronVersion, platform, arch }) => {
            for (const hook of hooks) {
                try {
                    await (0, node_util_1.promisify)(hook)(buildPath, electronVersion, platform, arch);
                }
                catch (err) {
                    d('hook failed:', hook.toString(), err);
                    throw err;
                }
            }
        },
    ];
}
function sequentialFinalizePackageTargetsHooks(hooks) {
    return [
        async (targets) => {
            for (const hook of hooks) {
                await (0, node_util_1.promisify)(hook)(targets);
            }
        },
    ];
}
`;

fs.writeFileSync(target, source.slice(0, start) + replacement + source.slice(end), "utf8");
console.log("Applied Electron Forge compatibility for Electron Packager v20 promise hooks.");
