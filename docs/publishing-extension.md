# Publishing extension and Windows companion

AgenticThat publishing uses three coordinated components:

1. The dashboard deployed on Netlify.
2. The AgenticThat Publishing Companion extension from the Chrome Web Store.
3. The AgenticThat Publishing Companion Windows application.

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
6. Add each social account in Config Manager and choose **Login**. Enter the
   account credentials and verification codes manually in the Chrome window.

The setup card reports whether the extension, companion, and Google Chrome are
ready before allowing Publish Queue sign-in.

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
dashboard, extension, or companion. They are typed directly into the social
network page. Publishing data and browser sessions remain in the companion's
Windows user-data directory. The extension is limited to the production
dashboard origin and the loopback companion address.

Browser publishing still depends on third-party interfaces. Platform UI
changes, CAPTCHA, account restrictions, and internet outages can require manual
action; these conditions are recorded as recoverable failures rather than
reported as successful posts.
