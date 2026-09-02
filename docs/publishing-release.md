# Publishing Companion release guide

## One-time owner setup

1. Register a Chrome Web Store developer account.
2. Run `npm run publishing:extension:package` and upload the ZIP from
   `artifacts/` as a new listing.
3. Copy the listing text and permission explanations from
   `docs/chrome-web-store-listing.md`, use
   `https://agentic-that.netlify.app/publishing/privacy` as the privacy URL, and
   submit the extension for review.
4. After approval, add the public listing URL to Netlify as
   `NEXT_PUBLIC_PUBLISHING_EXTENSION_URL` with Builds scope.
5. Keep `NEXT_PUBLIC_PUBLISHING_COMPANION_DOWNLOAD_URL` set to the stable GitHub
   Setup installer URL documented in `docs/netlify-env.md`. The installer is the
   supported customer build because it provides auto-start and automatic updates.

### Windows distribution without security warnings

Use Microsoft Store MSIX distribution as the primary public installation path:

1. Register in Microsoft Partner Center and reserve the
   **AgenticThat Publishing Companion** app name.
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

The workflow signs releases when `WINDOWS_CERTIFICATE_BASE64` and
`WINDOWS_CERTIFICATE_PASSWORD` are configured, and verifies the Authenticode
signature before publishing. Until those secrets are added, it can publish an
unsigned installer and Windows may show a SmartScreen warning.

For a zero-warning consumer installation, publish an MSIX package through the
Microsoft Store. Microsoft signs Store MSIX submissions after certification.
Direct downloads must still build SmartScreen reputation even when they have a
valid CA-trusted signature.

## Publish a version

Before tagging a customer release:

1. Run `npm run test:publishing` and `npm run build`.
2. Confirm production dependency audits report no known vulnerabilities for
   both the repository and desktop app.
3. Complete `docs/publishing-companion-production-validation.md` with owned test
   accounts before presenting the build as fully production-validated.
4. Verify the Account health dashboard and activity log show the expected
   Green, Warning, Paused, or Restricted state.
5. Confirm the release remains local-profile based and contains no stealth,
   proxy-rotation, CAPTCHA-bypass, or automation-hiding browser flags.

After the code is on `main`, create and push the release tag:

```text
git tag v2.0.0
git push origin v2.0.0
```

Use a SemVer tag (`vX.Y.Z`) so Electron's public update service can discover the
release. GitHub Actions builds the Squirrel installer, update manifest, full
update package, Portable ZIP, checksums, and optional Chrome extension. It signs
and verifies the installer automatically whenever signing secrets are present.
The legacy Publishing Companion ZIP alias remains available for existing
Netlify download links.

For a dry run without publishing a release, open the repository's **Actions**
tab, select **Publishing Companion Release**, and choose **Run workflow**. The
artifacts are available from that workflow run.

## Workspace Companion

The Workspace Manager installs and pairs one Companion from **Connections →
Publishing → Pair this device**. No ngrok, Cloudflare URL, public port, or team
device setup is required. The paired Companion keeps social-media sessions on
the manager device and uses token-scoped Supabase RPCs for jobs, leases,
heartbeats, progress, cancellation, and durable results. It never receives the
database connection string or Supabase secret key.

Content Uploaders and Schedulers use the website from their own devices. They
see the accounts allowed by their role but do not install, configure, or receive
the Companion's social-media session. If the paired Companion is offline, jobs
remain safely queued and resume after it reconnects.
