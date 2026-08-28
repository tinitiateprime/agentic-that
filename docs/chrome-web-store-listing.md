# Chrome Web Store submission

## Listing copy

- **Name:** AgenticThat Companion
- **Category:** Productivity
- **Summary:** Connect AgenticThat publishing and scraping to its local Companion.
- **Single purpose:** Securely bridge the AgenticThat publishing dashboard to
  the local AgenticThat Companion running on the same computer.

Suggested description:

> AgenticThat Companion connects publishing and scraping in the AgenticThat
> dashboard to the local engine installed on your Windows computer. It transfers
> selected post media, queue actions, and public scraping requests to Companion
> and returns results to the authenticated workspace. Social-network login
> remains manual on provider pages; the extension never receives or stores
> social passwords.

## Permission explanations

- `http://127.0.0.1:8792/*`: communicate with the companion installed on the
  same computer.
- `https://agentic-that.netlify.app/*`: expose the bridge only inside the
  AgenticThat dashboard.
- Optional `https://*/*`: lets the user approve one exact custom AgenticThat
  dashboard origin from the extension popup. No additional origin is granted
  until Chrome shows and the user accepts that permission.

## Upload checklist

1. Run `npm run publishing:extension:package`.
2. Upload `artifacts/AgenticThat-Companion-Extension-1.2.0.zip`.
3. Use `extensions/publishing-companion/icons/icon-128.png` as the store icon.
4. Enter `https://agentic-that.netlify.app/publishing/privacy` as the public
   privacy-policy URL.
5. Complete the data-use questionnaire using the behavior described above.
6. Submit for review. After approval, set Netlify environment variable
   `NEXT_PUBLIC_PUBLISHING_EXTENSION_URL` to the public Web Store listing URL.
