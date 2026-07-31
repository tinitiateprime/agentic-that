# Publish Queue Runner

Publish Queue Runner is the local execution service behind AgenticThat's Netlify
publishing dashboard. It supports Facebook, Instagram, X, LinkedIn, and YouTube
through isolated account sessions and fully manual social-account login in a
dedicated normal Chrome or Edge window.

Customers use the packaged Windows companion; they do not run this service or
edit JSON files. The companion stores queue metadata and media locally, checks
schedules every minute, and opens a dedicated Chrome profile for each account.
The Chrome extension securely connects the deployed dashboard to that loopback
service.

## Customer workflow

1. Install the Chrome extension and Windows companion from the dashboard.
2. Copy the dashboard credentials shown in the companion.
3. Add social accounts in Config Manager and choose **Login** for each one.
4. Enter credentials manually in the dedicated Chrome or Edge provider page.
   Companion detects success, protects the session locally, and closes that
   sign-in window automatically.
5. Create a post, choose a normal image or video file, select accounts, and
   publish now or schedule a future time.

No structured folders are required. Media is transferred to the companion in
safe, size-checked chunks. The computer must stay powered on and the companion
must remain running for scheduled publishing.

## Reliability behavior

- Queue execution is serialized and account concurrency is bounded.
- Posts are marked processing before browser work and retain attempt details.
- Interrupted work is held for review by default to reduce duplicate risk.
- Expired sessions mark the account **Login required** and preserve the post.
- Upload extension, MIME family, size, chunk offsets, and signature are checked.
- Platform UI changes, CAPTCHA, restrictions, or outages surface as recoverable
  failures instead of silent success.
- CAPTCHA, checkpoints, rate-limit responses, and uncertain final clicks pause
  the account for manual review. The final publish action is never blindly
  retried.
- Content pre-flight blocks private or credential-bearing links and accidental
  exact queue duplicates. Spam-like patterns and recent same-account repeats
  require explicit confirmation.
- Reusing the same campaign content across different apps is allowed without a
  duplicate warning.
- Media publishing requires the user to confirm ownership or permission.

## Default account pacing

These are conservative product defaults, not platform guarantees. The limits
are rolling per account and successful posts are separated by a minimum gap.

| App | Standard hourly | Standard daily | Minimum gap |
| --- | ---: | ---: | ---: |
| Instagram | 1 | 6 | 60 minutes |
| Facebook | 2 | 10 | 30 minutes |
| LinkedIn | 1 | 3 | 60 minutes |
| X | 4 | 30 | 15 minutes |
| YouTube video | 1 | 3 | 60 minutes |
| YouTube Community | 2 | 6 | 30 minutes |

Newly connected accounts default to **Protected** pacing: half the hourly and
daily allowance (minimum one) and at least a 60-minute gap. This mode never
rejects an account and can be changed to **Standard** for an established
account. Accounts do not need likes or followers to be connected.

## Safety boundary

No browser publisher can be undetectable or ban-proof. This product uses the
customer's visible local Chromium session, stable profiles, bounded pacing,
manual login, transparent status, and stop-on-risk behavior. It does not use
stealth patches, biometric impersonation, proxy rotation, CAPTCHA bypasses, or
browser flags that hide automation. Customers remain responsible for each
platform's terms and for the content they publish.

## Developer commands

```text
npm run publishing:companion
npm run publishing:desktop:start
npm run test:publishing
npm run publishing:release:windows
npm run build
```

See `docs/publishing-extension.md` for architecture, distribution, and customer
setup details.
