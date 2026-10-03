const index = process.argv.indexOf("--url");
const origin = new URL(index >= 0 ? process.argv[index + 1] : "https://www.agenticthat.com");
if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password) throw new Error("Use an HTTP(S) site URL without credentials.");
const checks = [
  ["/", 200], ["/health", 200], ["/v1/health", 200],
  ["/api/telegram/health", 200], ["/api/scraping/instagram/health", 200],
  ["/api/scraping/facebook/health", 200], ["/api/publishing/health", 401],
  ["/api/website-studio", 401], ["/api/admin-center/project-management/repositories", 401],
];
let failures = 0;
await Promise.all(checks.map(async ([path, expected]) => {
  try {
    const response = await fetch(new URL(path, origin), { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(20_000) });
    let passed = response.status === expected;
    if (path === "/health" && passed) {
      const body = await response.json();
      passed = body.ok === true && body.provider === "aws-amplify";
    }
    if (!passed) failures++;
    console.log(`${passed ? "PASS" : "FAIL"} ${path}: HTTP ${response.status} (expected ${expected})`);
  } catch (error) {
    failures++;
    console.log(`FAIL ${path}: ${error.name}`);
  }
}));
console.log(`${checks.length - failures}/${checks.length} public deployment checks passed for ${origin.origin}.`);
process.exitCode = failures ? 1 : 0;
