# AI Phone Front Desk: email and calendar setup

This add-on is paused by default. While paused, the receptionist saves calls and unconfirmed appointment requests without sending follow-up emails or booking Google Calendar events; its setup fields stay hidden. When you choose to launch it, set `PHONE_FRONT_DESK_FOLLOW_UP_ENABLED=true` in Netlify and redeploy, then follow the steps below.

The receptionist saves each completed call, then sends a summary to the profile's **Follow-up email** through Resend. High-priority leads trigger an immediate alert as well. A failed summary can be retried from the call history. The AI never claims a booking until Google Calendar accepts the event.

## Resend

In Netlify, set `RESEND_API_KEY` and `AUTH_EMAIL_FROM` to the same working values used by the existing email system. Use a sender on the verified domain. In the Phone Front Desk profile, set **Follow-up email** to the address that should receive call summaries and urgent alerts.

## Google Calendar (one shared-calendar setup; no OAuth client needed)

1. In [Google Cloud Console](https://console.cloud.google.com/), create or choose a project and enable **Google Calendar API**.
2. Under **IAM & Admin → Service Accounts**, create a dedicated service account. Create and download a **JSON key** for it. Treat the key as a secret.
3. Convert that JSON file to base64 locally. In PowerShell:

   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\path\to\service-account.json'))
   ```

4. Add the result as `GOOGLE_CALENDAR_SERVICE_ACCOUNT_BASE64` in **Netlify → Site configuration → Environment variables**. Do not paste it into chat, source control, or a `NEXT_PUBLIC_` variable. Redeploy so the server picks it up.
5. In Google Calendar, open the business calendar's **Settings and sharing**. Share it with the service account's `client_email` from the JSON key and give it permission to edit events. Some Google interfaces call this **Make changes** or **Make changes and see event details**. A work/school administrator may restrict external sharing.
6. Copy that calendar's **Calendar ID** from **Integrate calendar**. In the Phone Front Desk profile, enter the Calendar ID, an IANA time zone (for example `Asia/Kolkata`), and appointment length. Save and click **Verify calendar access**.
7. Run one test conversation: ask for a specific free time, explicitly agree to book it, then confirm the event appears in the shared calendar and the call summary reaches the Follow-up email. The Verify button checks availability and edit permissions; the test booking checks the complete flow.

Each business can set its own calendar ID and time zone. The same service account must be given edit access to every calendar it books. This setup creates calendar events but does **not** invite callers as Google Calendar attendees or send them a calendar email. If calendar access is missing or booking fails, the assistant should capture an unconfirmed appointment request instead.
