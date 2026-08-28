# AgenticThat Companion release guide

## One-time owner setup

1. Register a Chrome Web Store developer account.
2. Run `npm run publishing:extension:package` and upload the versioned
   `AgenticThat-Companion-Extension-*.zip` from `artifacts/` as a new listing.
3. Copy the listing text and permission explanations from
   `docs/chrome-web-store-listing.md`, use
   `https://agentic-that.netlify.app/publishing/privacy` as the privacy URL, and
   submit the extension for review.
4. After approval, add the public listing URL to Netlify as
   `NEXT_PUBLIC_PUBLISHING_EXTENSION_URL` with Builds scope.
5. Keep `NEXT_PUBLIC_PUBLISHING_COMPANION_DOWNLOAD_URL` set to the stable GitHub
   portable Release URL documented in `docs/netlify-env.md`.

### Windows distribution without security warnings

Use Microsoft Store MSIX distribution as the primary public installation path:

1. Register in Microsoft Partner Center and reserve the
   **AgenticThat Companion** app name.
2. Open the reserved product's **Product identity** page and copy its
   **Package/Identity/Name**, **Package/Identity/Publisher**, and publisher
   display name exactly.
3. In GitHub Actions, run **Publishing Companion Microsoft Store Package** and
   enter those three values.
4. Download the `publishing-companion-microsoft-store-msix` workflow artifact
   and submit the MSIX in Partner Center.
5. After Microsoft certification, use the Microsoft Store listing as the
   website's primary Companion installation link. Microsoft signs the certified
   MSIX, so users do not receive SmartScreen or Smart App Control warnings
   during Store installation.

The current GitHub release workflow publishes an **unsigned Portable ZIP only**
for product testing. Windows may show a security warning because it is not code
signed. Switch back to signed portable and installer releases before public
production distribution by adding `WINDOWS_CERTIFICATE_BASE64` and
`WINDOWS_CERTIFICATE_PASSWORD` and restoring signature verification.

For a zero-warning consumer installation, publish an MSIX package through the
Microsoft Store. Microsoft signs Store MSIX submissions after certification.
Direct downloads must still build SmartScreen reputation even when they have a
valid CA-trusted signature.

## Publish a version

Before tagging a customer release:

1. Run `npm run test:publishing` and `npm run build`.
2. Confirm production dependency audits report no known vulnerabilities for
   both the repository and desktop app.
3. Test one account per supported app with visible manual login, a normal post,
   a scheduled post, warning confirmation, account pause/resume, and emergency
   stop.
4. Verify the Account health dashboard and activity log show the expected
   Green, Warning, Paused, or Restricted state.
5. Confirm the release remains local-profile based and contains no stealth,
   proxy-rotation, CAPTCHA-bypass, or automation-hiding browser flags.

After the code is on `main`, create and push the release tag:

```text
git tag publishing-v1.1.3
git push origin publishing-v1.1.3
```

GitHub Actions builds the Portable ZIP and the validated Companion extension,
then publishes both versioned and stable filenames. Netlify uses the stable
portable download. The extension ZIP is suitable for Chrome Web Store upload
or unpacked testing after extraction. This temporary test-release workflow
does not publish a signed installer.

For a dry run without publishing a release, open the repository's **Actions**
tab, select **Publishing Companion Release**, and choose **Run workflow**. The
artifacts are available from that workflow run.

## Workspace Companion

The Workspace Manager installs and pairs one Companion from **Connections →
Publishing → Pair this device**. No ngrok, Cloudflare URL, public port, or team
device setup is required. The paired Companion keeps social-media sessions on
the manager device, polls the AgenticThat server for approved workspace jobs,
and reports live progress back to the website.

Content Uploaders and Schedulers use the website from their own devices. They
see the accounts allowed by their role but do not install, configure, or receive
the Companion's social-media session. If the paired Companion is offline, jobs
remain safely queued and resume after it reconnects.
