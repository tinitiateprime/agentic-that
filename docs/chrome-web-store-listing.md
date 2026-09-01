# Chrome Web Store submission

## Listing copy

- **Name:** AgenticThat Companion
- **Category:** Productivity
- **Summary:** Optionally connect an AgenticThat web dashboard to its local Companion.
- **Single purpose:** Securely bridge the AgenticThat publishing dashboard to
  the local AgenticThat Publishing Companion running on the same computer.

Suggested description:

> AgenticThat Companion connects a publishing dashboard opened in Chrome to
> the local Companion installed on your Windows computer. It
> transfers selected post media and queue actions to the local companion and
> displays local media previews. Social-network login remains manual on the
> provider page inside Companion or its optional Chrome fallback; the extension
> never receives or stores social passwords.

## Permission explanations

- `http://127.0.0.1:8792/*`: communicate with the companion installed on the
  same computer.
- `https://agentic-that.netlify.app/*`: expose the bridge only inside the
  AgenticThat dashboard.
- `storage`: remember only the user's explicitly trusted dashboard origins.
- `scripting` and optional `https://*/*`: after a user grants one exact HTTPS
  dashboard origin, register the restricted bridge on that origin only.

## Upload checklist

1. Run `npm run publishing:extension:package`.
2. Upload `artifacts/AgenticThat-Publishing-Extension-1.3.0.zip`.
3. Use `extensions/publishing-companion/icons/icon-128.png` as the store icon.
4. Enter `https://agentic-that.netlify.app/publishing/privacy` as the public
   privacy-policy URL.
5. Complete the data-use questionnaire using the behavior described above.
6. Submit for review. After approval, set Netlify environment variable
   `NEXT_PUBLIC_PUBLISHING_EXTENSION_URL` to the public Web Store listing URL.
