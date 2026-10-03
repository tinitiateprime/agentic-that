# AI Phone Front Desk: Google connections

`PHONE_FRONT_DESK_FOLLOW_UP_ENABLED` is off by default. Website Studio preview emails continue to use AgenticThat's existing Resend sender; Phone Front Desk call summaries and urgent alerts use the connected business Gmail account when follow-up is enabled.

## Google Cloud setup

1. Enable the Google Calendar API and Gmail API in one Google Cloud project.
2. Configure the OAuth consent screen. Add local test users while the app is in Testing.
3. Create an **OAuth 2.0 Client ID** of type **Web application** (not a service account).
4. Add the authorized redirect URI `http://localhost:3000/api/phone-front-desk/google/callback` for local testing. Production will need `https://agenticthat.com/api/phone-front-desk/google/callback` or the configured public domain.
5. Declare the calendar-list, calendar-events, free/busy, and Gmail-send permissions on the consent screen. Google may require app verification before external businesses can connect. Testing-mode refresh tokens for non-basic scopes expire after seven days.

## Local settings

Add these to `.env.local` without sharing the values in chat or committing them:

```dotenv
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
CREDENTIAL_ENCRYPTION_KEY=
```

Generate `CREDENTIAL_ENCRYPTION_KEY` locally (for example, `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`). It is not provided by Google. Keep it private and stable: replacing it after Google connections are stored makes their tokens unreadable. Placeholder and short values are rejected.

Apply `supabase/migrations/202609250001_ai_phone_front_desk_google_connections.sql` to the target database through the approved migration workflow before setting `PHONE_FRONT_DESK_FOLLOW_UP_ENABLED=true`. The service account key and manual Calendar ID field are not required for new Google connections.

## Netlify production settings

Set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `PHONE_FRONT_DESK_FOLLOW_UP_ENABLED=true` in the site's server-side environment. Confirm `PLATFORM_PUBLIC_URL=https://agenticthat.com` and that `DATABASE_URL` points to the migrated database. Add `https://agenticthat.com/api/phone-front-desk/google/callback` to the Google OAuth web client's authorized redirect URIs. `GOOGLE_OAUTH_REDIRECT_URI` can be omitted when `PLATFORM_PUBLIC_URL` is correct; never leave a localhost redirect override in Netlify.

Keep any existing Netlify `CREDENTIAL_ENCRYPTION_KEY` unchanged: WhatsApp credentials and admin MFA may also depend on it. Existing local Google connections can be read in production only if Netlify uses the same encryption key **and** OAuth client. If either differs, connect Calendar and Gmail again from the deployed site instead of replacing an in-use production key. `GOOGLE_CALENDAR_SERVICE_ACCOUNT_BASE64` and Resend are not required for the new business-owned Google connections.

An external OAuth app in Google's **Testing** status only accepts listed test users, and its non-basic refresh tokens expire after seven days. Public client onboarding needs the appropriate production publishing and Google verification for the requested scopes.

## Verification

1. Open AI Phone Front Desk and connect Google Calendar. Choose a writable calendar from the dropdown, set the business's **Booking time zone** (which can differ from the Google calendar's default), save it, then click **Verify access**.
2. Connect Gmail as the business mailbox and click **Send test email**. Confirm the message appears in that mailbox's Sent folder and inbox.
3. Make a typed or voice test call, verify one calendar event was created for the chosen workspace, and confirm the summary/urgent alert is sent from the connected Gmail address to the configured follow-up inbox.
4. Disconnect each connection and verify new booking/email requests stop. Reconnect and repeat.

The calendar and Gmail buttons are separate because a business may use different Google accounts for scheduling and mail. Other email providers (such as Microsoft 365) are not yet connected. Customer-facing booking-confirmation emails also require collecting and validating the customer's email address; this demo currently sends call summaries and urgent alerts to the business inbox.
