import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";

test("signup keeps verification pending and updates delivery status after resend", async (context) => {
  const executablePath = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find(candidate => candidate && existsSync(candidate));
  if (!executablePath) { context.skip("Chrome is unavailable for the UI test."); return; }
  const bundle = await build({
    stdin: {
      contents: `import React from "react"; import { createRoot } from "react-dom/client";
        import AuthModal from "./AuthModal.jsx";
        window.authEvents = [];
        createRoot(document.getElementById("root")).render(<AuthModal open initialMode="signup"
          onClose={() => window.authEvents.push("closed")}
          onAuthenticated={() => window.authEvents.push("authenticated")} />);`,
      resolveDir: fileURLToPath(new URL(".", import.meta.url)),
      loader: "jsx",
    },
    bundle: true, write: false, jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' },
  });
  const server = createServer((request, response) => {
    if (request.url === "/ui.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].contents); }
    else { response.setHeader("content-type", "text/html"); response.end('<div id="root"></div><script src="/ui.js"></script>'); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({ executablePath, headless: true });
  context.after(() => browser.close());
  const page = await browser.newPage();
  let resendCount = 0;
  await page.route("**/api/platform-auth/signup", route => route.fulfill({ json: {
    ok: true, user: {name: "AWS email test"}, verificationRequired: true, emailDeliveryFailed: true,
  } }));
  await page.route("**/api/platform-auth/resend-verification", route => {
    resendCount++;
    return route.fulfill(resendCount === 1
      ? {status: 503, json: {error: "Email delivery is temporarily unavailable. Please try again later or contact support."}}
      : {json: {ok: true, message: "If the account needs verification, a new link has been sent."}});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByLabel("Full name").fill("AWS email test");
  await page.getByLabel("Company", {exact:true}).fill("AWS UI test");
  await page.getByLabel("Work email").fill("test@example.com");
  await page.getByPlaceholder("At least 8 characters").fill("test-password-123");
  await page.getByLabel("Confirm password").fill("test-password-123");
  await page.getByRole("button", {name:"Continue to access"}).click();
  await page.getByRole("button", {name:"Activate full access"}).click();
  await page.getByRole("heading", {name:"Verify your email"}).waitFor();
  assert.match(await page.locator(".auth-success").innerText(), /couldn't send the verification email/);
  assert.doesNotMatch(await page.locator(".auth-success").innerText(), /link expires/);
  await page.getByRole("button", {name:"Resend verification email"}).click();
  await page.getByRole("alert").filter({hasText:"Email delivery is temporarily unavailable"}).waitFor();
  await page.getByRole("button", {name:"Resend verification email"}).click();
  await page.locator(".auth-notice").waitFor();
  assert.equal(await page.getByRole("alert").innerText(), "");
  assert.doesNotMatch(await page.locator(".auth-success").innerText(), /couldn't send/);
  assert.match(await page.locator(".auth-success").innerText(), /Check your inbox/);
  assert.equal(await page.getByRole("button", {name:"Resend verification email"}).count(), 1);
  await page.keyboard.press("Escape");
  assert.deepEqual(await page.evaluate(() => window.authEvents), ["closed"]);
});
