// The AI chat apps a user can connect in the Companion. Each one is used through
// the user's own login, in their own Chrome or Edge profile. Selectors are
// lists, tried in order, because these sites change their pages often.

export const AI_PROVIDERS = ["chatgpt", "claude", "gemini"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

export type ProviderSpec = {
  id: AiProviderId;
  label: string;
  /** Hosts that belong to the app itself (not its login pages). */
  appHosts: string[];
  /** Where a fresh conversation starts. */
  newChatUrl: string;
  /** Where the login window opens. */
  loginUrl: string;
  /** Paths on an app host that are still part of signing in. */
  loginPaths: RegExp;
  prompt: string[];
  fileInput: string[];
  /** Buttons that open the attach menu, for apps that only add a file input after a click. */
  attachButtons: string[];
  /** The menu item that then opens the file picker. */
  attachMenuItems: string[];
  send: string[];
  stop: string[];
  answer: string[];
  /** Visible only when signed out. */
  signedOut: string[];
};

export const PROVIDERS: Record<AiProviderId, ProviderSpec> = {
  chatgpt: {
    id: "chatgpt",
    label: "ChatGPT",
    appHosts: ["chatgpt.com"],
    newChatUrl: "https://chatgpt.com/",
    loginUrl: "https://chatgpt.com/auth/login",
    loginPaths: /^\/(auth|login)/,
    // Checked on the live site (2026-11): a textarea named "prompt" and a "Send message"
    // button. Older layouts (#prompt-textarea, data-testid buttons) are kept as fallbacks.
    prompt: ["textarea[name='prompt']", "#mobile-composer-prompt", "textarea[aria-label*='ChatGPT']", "#prompt-textarea", "div[contenteditable='true'][id='prompt-textarea']", "form div[contenteditable='true']"],
    // Signed in, the inputs have generated ids; each is tried until a thumbnail appears.
    fileInput: ["input[type='file'][id*='files-input']", "input[type='file'][id*='photos-input']", "input[type='file'][accept='image/*,video/*']", "input[type='file']:not([accept])", "input[type='file'][accept*='image']", "input[type='file']"],
    // Signed in, the upload inputs appear a few seconds after the chat box; the
    // "+" button ("Add files and more") is the way in if they haven't.
    attachButtons: ["button[aria-label='Add files and more']", "button[aria-label*='Add photos']", "button[aria-label*='Attach']"],
    attachMenuItems: ["[role='menuitem']:has-text('Add photos')", "[role='menuitem']:has-text('photos & files')", "[role='menuitem']:has-text('Upload')", "[role='menuitem']:has-text('Files')"],
    // Signed in, the button is labelled just "Send"; signed out, "Send message".
    send: ["button[aria-label='Send']", "button[aria-label='Send message']", "button[data-testid='send-button']", "#composer-submit-button", "button[aria-label='Send prompt']", "button[aria-label^='Send']"],
    stop: ["button[aria-label='Stop generating']", "button[aria-label='Stop streaming']", "button[data-testid='stop-button']", "button[aria-label*='Stop']"],
    // The 2026 layout has no role labels: the conversation is a list and only
    // ChatGPT's replies contain a <section>.
    // Signed in (2026-11), each reply is one "MarkdownRoot-…" block holding the whole answer.
    answer: ["[data-message-author-role='assistant']", "div[class*='MarkdownRoot']", "ol > li:has(section)"],
    signedOut: ["button[data-testid='login-button']", "a[href*='/auth/login']", "button:has-text('Log in')"],
  },
  claude: {
    id: "claude",
    label: "Claude",
    appHosts: ["claude.ai"],
    newChatUrl: "https://claude.ai/new",
    loginUrl: "https://claude.ai/login",
    loginPaths: /^\/(login|signup|magic-link|onboarding)/,
    prompt: ["div.ProseMirror[contenteditable='true']", "fieldset div[contenteditable='true']", "div[contenteditable='true']"],
    fileInput: ["input[data-testid='file-upload']", "input[type='file']"],
    attachButtons: [],
    attachMenuItems: [],
    // Checked signed in (2026-11): data-testid "chat-input-send".
    send: ["button[data-testid='chat-input-send']", "button[aria-label='Send message']", "button[aria-label='Send Message']", "button[aria-label*='Send']"],
    stop: ["button[aria-label='Stop response']", "button[aria-label='Stop Response']", "button[aria-label*='Stop']"],
    answer: [".font-claude-response", "[data-is-streaming]", ".font-claude-message"],
    signedOut: ["input[type='email']", "button:has-text('Continue with Google')"],
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    appHosts: ["gemini.google.com"],
    newChatUrl: "https://gemini.google.com/app",
    loginUrl: "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fgemini.google.com%2Fapp",
    loginPaths: /^\/(signin|login)/,
    prompt: ["rich-textarea div[contenteditable='true']", "div.ql-editor[contenteditable='true']", "div[contenteditable='true'][role='textbox']"],
    // No upload inputs until the menu is used: "Upload & tools", then "Upload files" opens the picker.
    fileInput: [],
    attachButtons: ["button[aria-label='Upload & tools']", "button[aria-label*='Upload']", "button[aria-label*='Add files']"],
    attachMenuItems: ["button[data-test-id='local-images-files-uploader-button']", "[role='menuitem'][aria-label*='Upload files']", "button:has-text('Upload files')"],
    send: ["button[aria-label='Send message']", "button.send-button", "button[aria-label*='Send']"],
    stop: ["button[aria-label='Stop response']", "button[aria-label*='Stop']"],
    answer: ["model-response message-content", "model-response .markdown", "model-response"],
    signedOut: ["a[href*='ServiceLogin']", "a[aria-label='Sign in']", "a:has-text('Sign in')"],
  },
};

export function isAiProvider(value: unknown): value is AiProviderId {
  return typeof value === "string" && (AI_PROVIDERS as readonly string[]).includes(value);
}

/** True when the address is the app itself and not one of its sign-in pages. */
export function onAppPage(spec: ProviderSpec, url: string) {
  try {
    const parsed = new URL(url);
    return spec.appHosts.includes(parsed.hostname) && !spec.loginPaths.test(parsed.pathname);
  } catch {
    return false;
  }
}

/** "Just a moment...", Cloudflare's checkbox, Google's unusual-traffic page: the user has to step in. */
export function looksLikeHumanCheck(title: string, url: string, frameUrls: string[] = []) {
  return /just a moment|verify (that )?you are human|attention required|unusual traffic|are you a robot/i.test(title)
    || /\/sorry\/|challenges\.cloudflare\.com|\/cdn-cgi\/challenge/i.test(url)
    || frameUrls.some((frame) => /challenges\.cloudflare\.com|recaptcha|hcaptcha/i.test(frame));
}
