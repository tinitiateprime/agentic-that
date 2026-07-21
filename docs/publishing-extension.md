# Publishing extension and companion

AgenticThat publishing has three parts:

1. The dashboard deployed on Netlify.
2. The Manifest V3 Chrome extension in `extensions/publishing-companion`.
3. The local publishing companion started by `Start Publishing Companion.cmd`.

The dashboard stores publishing data in the companion's local JSON store for
this phase. The extension securely proxies dashboard requests and media previews
to `http://127.0.0.1:8792`. The companion owns scheduling and opens a dedicated
Chrome profile for each configured Facebook, Instagram, X, LinkedIn, or YouTube
account.

## Install for development

1. Double-click `Install Publishing Extension.cmd`.
2. Enable **Developer mode** in `chrome://extensions`.
3. Select **Load unpacked**.
4. Choose `extensions/publishing-companion`.
5. Double-click `Start Publishing Companion.cmd`.
6. Open `https://agenticthat.netlify.app/publishing`.

For customer distribution, publish the extension through the Chrome Web Store.
If the dashboard moves to a custom domain, add that exact origin to the content
script and web-accessible-resource matches in `manifest.json`.

## Account login

Create a publishing account in Config Manager, then choose **Login**. The
companion opens that account's dedicated Chrome profile. The user enters all
credentials and verification codes manually. AgenticThat stores only the local
Chrome session; it never requests or stores the social-network password.

## Scheduling behavior

The companion checks due posts every minute. The computer must be powered on and
the companion must be running. If the companion was stopped during a publish,
the post is held for review by default to prevent an accidental duplicate. If a
saved session expires, the account is marked **Login required** and the post is
kept in the review queue.

Schedule times use the publishing computer's configured timezone. For this
workspace, keep `PUBLISH_QUEUE_SCHEDULER_TIMEZONE=Asia/Kolkata`.
