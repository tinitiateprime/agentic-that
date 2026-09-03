# Publishing Companion release guide

## Optional Chrome compatibility setup

The production website + Supabase + Companion flow does not require an
extension. Complete these steps only if the legacy Chrome bridge will also be
offered:

1. Register a Chrome Web Store developer account.
2. Run `npm run publishing:extension:package` and upload the ZIP from
   `artifacts/` as a new listing.
3. Copy the listing text and permission explanations from
   `docs/chrome-web-store-listing.md`, use
   `https://agentic-that.netlify.app/publishing/privacy` as the privacy URL, and
   submit the extension for review.
4. After approval, add the public listing URL to Netlify as
   `NEXT_PUBLIC_PUBLISHING_EXTENSION_URL` with Builds scope.
5. Keep `NEXT_PUBLIC_PUBLISHING_COMPANION_DOWNLOAD_URL=/companion/download` as
   documented in `docs/netlify-env.md`. That page selects Windows, macOS, or
   Linux release assets without requiring the Chrome extension.

### Required release credentials

Production tags are intentionally prevented from publishing unless all of the
following are configured and validation has been completed:

- Windows: `WINDOWS_CERTIFICATE_BASE64` and `WINDOWS_CERTIFICATE_PASSWORD`.
- macOS signing: `MACOS_CERTIFICATE_BASE64` and `MACOS_CERTIFICATE_PASSWORD`.
- macOS notarization: `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, and
  `APPLE_API_ISSUER`.
- Live validation: set the repository variable
  `COMPANION_LIVE_MATRIX_APPROVED_VERSION` to the exact version only after the
  Windows/macOS/Linux owned-account matrix is recorded.

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

The workflow signs Windows builds when `WINDOWS_CERTIFICATE_BASE64` and
`WINDOWS_CERTIFICATE_PASSWORD` are configured and verifies the Authenticode
signature. Unsigned workflow-dispatch builds remain available for QA, but a
tagged production release will not publish without a valid signature.

For a zero-warning consumer installation, publish an MSIX package through the
Microsoft Store. Microsoft signs Store MSIX submissions after certification.
Direct downloads must still build SmartScreen reputation even when they have a
valid CA-trusted signature.

### macOS distribution

The release workflow builds a universal application on macOS so one DMG runs on
Intel and Apple Silicon. Import a Developer ID Application certificate with the
macOS certificate secrets and configure an App Store Connect API key with the
three Apple API secrets. Forge signs and notarizes the app before the DMG/ZIP
artifacts are collected. The release gate verifies both signing and Gatekeeper.

### Linux distribution

The workflow builds DEB, RPM, and portable ZIP artifacts on native x64 and ARM64
Linux runners. Linux users must have GNOME Keyring/libsecret or KWallet enabled;
Companion refuses to persist credentials through Electron's `basic_text`
fallback. Electron has no native Linux auto-updater, so upgrades are delivered
through a newer DEB/RPM installation or replacement portable ZIP.

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

After the code is on `main`, signing/notarization secrets are configured, and
the live matrix repository variable matches the version, create and push the
release tag:

```text
git tag v2.1.0
git push origin v2.1.0
```

Use a SemVer tag (`vX.Y.Z`) so Electron's public update service can discover the
release. GitHub Actions builds the Windows Squirrel installer/update package,
universal macOS DMG/ZIP, Linux DEB/RPM/ZIP for x64 and ARM64, checksums, and the
Windows updater metadata. The optional Chrome extension is distributed
separately. The final GitHub release is created only after every native job
succeeds and the production release gates pass.

For a dry run without publishing a release, open the repository's **Actions**
tab, select **Publishing Companion Release**, and choose **Run workflow**. The
artifacts are available from that workflow run.

For a downloadable cross-platform QA prerelease, push a numbered tag matching
the current package version, for example `v2.1.0-qa.1`. The workflow publishes
the native Windows, macOS, and Linux artifacts as a GitHub prerelease without
weakening the signing, notarization, or live-matrix gates on the final
`v2.1.0` production tag. QA artifacts may be unsigned and are for testing only.

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
