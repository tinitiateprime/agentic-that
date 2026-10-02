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
| Email | Real test rejected by Resend: sending domain `agenticthat.com` is not verified |
| Google credential migration | Both existing Google connections were successfully re-encrypted for AWS; their original refresh grants subsequently returned expired/revoked |

The timeout fixes reduce repeated workspace reads, exclude media payloads from status queries and avoid rewriting publishing history during dashboard reads. Global monitoring totals also read current job status directly. Queue changes still reconcile remote terminal jobs before selecting work, so a completed post cannot be selected again. Simultaneous reads are shared only while pending, remain scoped by workspace and return independent copies; completed data and permissions are not cached.

The installed Windows Companion was updated to 2.1.30 and used for the successful image and video tests. Instagram's compact-window Create control and LinkedIn's trusted browser click were corrected. Release signing and live verification on other operating systems remain required before a stable desktop release.

## Remaining external setup

- Verify the sending domain in Resend before email delivery, invitations and verification emails can pass.
- Reconnect Gmail and Google Calendar within Phone Front Desk before follow-up delivery and confirmed calendar bookings can pass. The real workspace's saved Google refresh grants returned expired/revoked after the encryption migration was fixed. Reconnect buttons allow replacing the grant without first deleting the connection. The isolated microphone test correctly retained an unsent email status.
- The expired Meta token remains deferred at the owner's request. Meta API messaging cannot be claimed verified; Companion browser publishing on Facebook and Instagram did pass.

These results prove the workflows and accounts tested. They do not guarantee every account, large media size, social platform change, live telephone line or desktop operating system.

Detailed sanitized reports are retained locally under `artifacts/aws-real-*-validation.json` and `artifacts/aws-publishing-concurrency-live.json`. Cookies, API keys, database URLs and signed media URLs are excluded from this report.
