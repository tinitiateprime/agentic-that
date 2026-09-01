# Optional AgenticThat Companion extension

This Manifest V3 extension bridges an AgenticThat dashboard opened in Chrome to
the Windows Companion on `127.0.0.1:8792`. The desktop Companion now embeds the
dashboard directly, so normal users do not need to install this extension.

The bridge accepts only loopback API/media paths and trusted dashboard origins.
The production AgenticThat origin is built in. A user may explicitly grant one
additional HTTPS origin from the popup; the extension requests that exact host
permission and registers only the bridge content script for it. Social-network
pages are never injected and passwords are never read or stored.

For local development, run `npm run publishing:extension:open`, enable Developer
mode in Chrome, choose **Load unpacked**, and select this directory.

Validate and build the review ZIP with:

```text
npm run publishing:extension:validate
npm run publishing:extension:package
```

The package command creates both a versioned ZIP and the stable
`AgenticThat-Publishing-Extension.zip` release alias.
