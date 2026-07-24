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
   portable Release URL documented in `docs/netlify-env.md`.

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

Public Windows releases require an RSA Authenticode certificate issued by a CA
in the Microsoft Trusted Root Program. Add its base64-encoded PFX as the GitHub
Actions secret `WINDOWS_CERTIFICATE_BASE64` and its password as
`WINDOWS_CERTIFICATE_PASSWORD`. The release workflow fails closed when either
secret is absent or when the Portable app and Setup executable do not have valid,
timestamped signatures. Unsigned builds are allowed only for local development
and must never be distributed.

For a zero-warning consumer installation, publish an MSIX package through the
Microsoft Store. Microsoft signs Store MSIX submissions after certification.
Direct downloads must still build SmartScreen reputation even when they have a
valid CA-trusted signature.

## Publish a version

After the code is on `main`, create and push the release tag:

```text
git tag publishing-v1.1.3
git push origin publishing-v1.1.3
```

GitHub Actions signs the packaged Companion binaries before creating the
Portable ZIP, signs the Windows installer, verifies both signatures and their
trusted timestamps, then builds the extension ZIP. The tag job publishes all
three as a GitHub Release. It also publishes the portable ZIP with a stable
unversioned filename, which is the download used by Netlify.

For a dry run without publishing a release, open the repository's **Actions**
tab, select **Publishing Companion Release**, and choose **Run workflow**. The
artifacts are available from that workflow run.
