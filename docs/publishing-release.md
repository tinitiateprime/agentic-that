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

For production distribution, obtain a Windows code-signing certificate. Add its
base64-encoded PFX as the GitHub Actions secret `WINDOWS_CERTIFICATE_BASE64` and
its password as `WINDOWS_CERTIFICATE_PASSWORD`. The release still builds without
these secrets for internal testing, but Windows will identify it as an unknown
publisher.

## Publish a version

After the code is on `main`, create and push the release tag:

```text
git tag publishing-v1.1.3
git push origin publishing-v1.1.3
```

GitHub Actions builds the extension ZIP, signed Windows installer when signing
secrets are configured, and portable ZIP. The tag job publishes all three as a
GitHub Release. It also publishes the portable ZIP with a stable unversioned
filename, which is the download used by Netlify.

For a dry run without publishing a release, open the repository's **Actions**
tab, select **Publishing Companion Release**, and choose **Run workflow**. The
artifacts are available from that workflow run.
