# AWS production verification — 2 October 2026

Actual workflows ran against `https://www.agenticthat.com`, its Supabase database and the installed Windows Companion. Temporary users and media were isolated from normal business activity. Test posts were explicitly authorized and marked as verification tests.

| Workflow | Result |
| --- | --- |
| Image publishing | Confirmed through Companion on Instagram I01, Facebook FB02, X X01, LinkedIn Link01 and YouTube yt03 (community image) |
| Video publishing | Confirmed on the same five accounts; YouTube video was unlisted |
| Saved account sessions | All five accounts used their connected browser sessions for actual publishing |
| Account creation | Five test account records created through the production API in an isolated workspace |
| Scheduling | Ten future test destinations created, idempotency checked, then canceled |
| Instagram scraping | Actual Companion scrape returned two live posts from mosseri with engagement data |
| Facebook scraping | Actual Companion scrape returned two live NASA reels; reel captions were unavailable |
| Private media | Workspace-scoped signed storage reads matched the original image and video bytes; cross-workspace lookup was rejected |
| Browser microphone | Actual WebRTC call recognized a spoken test question, answered correctly and saved its transcript and summary |
| Concurrent publishing reads | Twelve concurrent production API requests returned HTTP 200 |
| Email | Sending DNS restored and domain verified on 3 October; Resend accepted a real test and the owner confirmed inbox receipt |
| Google credential migration | Both existing Google connections were successfully re-encrypted for AWS; their original refresh grants subsequently returned expired/revoked |

The timeout fixes reduce repeated workspace reads, exclude media payloads from status queries and avoid rewriting publishing history during dashboard reads. Global monitoring totals also read current job status directly. Queue changes still reconcile remote terminal jobs before selecting work, so a completed post cannot be selected again. Simultaneous reads are shared only while pending, remain scoped by workspace and return independent copies; completed data and permissions are not cached.

The installed Windows Companion was updated to 2.1.30 and used for the successful image and video tests. Instagram's compact-window Create control and LinkedIn's trusted browser click were corrected. Release signing and live verification on other operating systems remain required before a stable desktop release.

## Remaining external setup

- Reconnect Gmail and Google Calendar within Phone Front Desk before follow-up delivery and confirmed calendar bookings can pass. The real workspace's saved Google refresh grants returned expired/revoked after the encryption migration was fixed. Reconnect buttons allow replacing the grant without first deleting the connection. The isolated microphone test correctly retained an unsent email status.
- The expired Meta token remains deferred at the owner's request. Meta API messaging cannot be claimed verified; Companion browser publishing on Facebook and Instagram did pass.

These results prove the workflows and accounts tested. They do not guarantee every account, large media size, social platform change, live telephone line or desktop operating system.

Detailed sanitized reports are retained locally under `artifacts/aws-real-*-validation.json` and `artifacts/aws-publishing-concurrency-live.json`. Cookies, API keys, database URLs and signed media URLs are excluded from this report.

## Email follow-up — 3 October 2026

An actual production signup reproduced the delivery failure. A direct provider request returned HTTP 403 because `agenticthat.com` was unverified. Route 53 contained the website records but lacked the earlier Resend DKIM and return-path CNAME records. Those three email records were restored from the owner's DNS export, preserving the existing Amplify website routing. After domain verification, Resend accepted the real test email and the owner confirmed inbox receipt. The production Email Studio also sent successfully through the deployed AWS application.

Failed verification and password reset retries now preserve earlier unexpired links. Completing a password reset consumes all remaining reset links and revokes existing sessions. Signup displays pending email verification, resend success updates the delivery status, and closing the modal keeps an unverified account unauthenticated. Email-provider rejections return a temporary-unavailability response without exposing provider configuration to the visitor.

Validation: the production build and GitHub CI passed, and Amplify deployment 12 deployed the email changes. Thirteen HTTP/database checks subsequently passed against the live AWS site and real Supabase database, including actual Resend acceptance for signup, resend and password reset. Seeded earlier tokens verified preservation and single-use behavior; completing reset revoked existing sessions. The isolated auth-flow accounts were removed. All nine public AWS deployment health checks also passed. Inbox receipt is separately confirmed by the owner.

Sanitized evidence: `artifacts/aws-email-dns-restoration.json`, `artifacts/aws-auth-email-after-dns-validation.json` and `artifacts/aws-auth-email-flow-patched-validation.json`.

## Current publishing follow-up ? 3 October 2026

The owner's next video batch completed on Instagram, Facebook, LinkedIn and YouTube, while X timed out. Its 126,716,294-byte video was treated as ready as soon as the preview appeared, before uploading and processing completed. X also displays informational and Premium screens that can cover the intended action. Companion 2.1.31 dismisses Got it notices and identifiable Premium offers, retains the composer and sign-in dialogs, waits for media processing and uses a trusted Post click. Delivery requires a returned provider post ID or an explicit sent confirmation.

After checking the X profile and finding no copy from the failed attempt, one replacement destination was submitted through the actual AWS and Supabase queue. The original uncertain attempt remains in history. X accepted the replacement, returned post ID 2106261496376508582, and its actual video post was independently inspected at https://x.com/testingdkp/status/2106261496376508582. The original batch's other four completed destinations were retained. No extra verification posts were sent.

The first replacement submission exposed a stale queued record: dashboard reads showed the remote failure, but creation's duplicate check still used the old persisted status. New destination creation now reconciles current remote outcomes before checking duplicates, while preserving staged-upload idempotency and uncertain job history. Regression tests cover that recovery.

Sanitized evidence: `artifacts/aws-x-current-publishing-recovery.json`, `artifacts/aws-x-current-post-before-retry.json` and `artifacts/aws-x-recovered-profile.png`.
