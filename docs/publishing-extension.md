# Publishing extension and Windows companion

AgenticThat publishing uses three coordinated components:

1. The dashboard deployed on Netlify.
2. The AgenticThat Companion extension from the Chrome Web Store.
3. The AgenticThat Companion Windows application.

The Netlify site remains the user interface. The Windows app owns the persistent
queue, uploaded media, scheduler, Chrome profiles, and browser publishing. The
extension is a restricted bridge from the dashboard to that app on
`127.0.0.1:8792`. This avoids trying to run a persistent browser or minute-by-minute
scheduler inside a request-based Netlify function.

## Customer setup

Customers do not download this repository or run commands.

1. Open `https://agentic-that.netlify.app/publishing` in Google Chrome.
2. Choose **Install extension** and confirm the Chrome Web Store installation.
3. Choose **Install Windows companion**, run the installer once, and leave
   **Start automatically with Windows** enabled.
4. Copy the dashboard login displayed by the companion app.
5. Return to the dashboard and choose **Check again**.
6. Add each social account in Config Manager and choose **Login**. An isolated
   sign-in pane opens inside Companion. Enter credentials and verification
   codes only on the provider page; Companion detects success, protects the
   session locally, and closes the pane automatically. If a provider blocks
   embedded sign-in, choose the account's **Chrome** fallback action.

The setup card reports whether the extension and Companion are ready before
allowing Publish Queue sign-in. Chrome or Edge is optional fallback software.

## Posting and scheduling

Create posts with the site's normal file picker or drag and drop; customers do
not create special folders. The companion checks the queue every minute and can
publish to Facebook, Instagram, X, LinkedIn, and YouTube using the saved manual
login session for the selected account.

The publishing computer must be powered on, connected to the internet, and
running the companion at the scheduled time. If it was stopped, overdue work is
picked up after it returns. An interrupted publish is held for review by default
so an uncertain browser result does not silently create a duplicate.

## Developer setup and release

Use the unpacked extension only for local development:

```text
npm install
npm run publishing:desktop:install
npm run publishing:companion
npm run publishing:extension:open
```

Build all customer artifacts on Windows with:

```text
npm run publishing:release:windows
```

This creates the Web Store ZIP and Windows installer in `artifacts/`. The GitHub
Actions publishing release workflow performs the same build for version tags.

## Security boundary

Social passwords and verification codes are never accepted by the AgenticThat
dashboard or extension. They are typed directly into the social network page
shown by Companion or the optional Chrome/Edge fallback. Publishing data and
browser sessions remain in the companion's Windows user-data directory. The
extension is limited to the production dashboard origin and the loopback
companion address.

Browser publishing still depends on third-party interfaces. Platform UI
changes, CAPTCHA, account restrictions, and internet outages can require manual
action; these conditions are recorded as recoverable failures rather than
reported as successful posts.
