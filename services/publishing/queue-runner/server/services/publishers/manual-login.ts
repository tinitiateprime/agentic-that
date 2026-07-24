import type { Page } from "playwright-core";

export type AccountLogin = {
  useSavedSessionOnly?: boolean;
  ignoreLoginErrors?: boolean;
};

type ManualLoginFallbackOptions = {
  page: Page;
  platform: string;
  normalTimeoutMs?: number;
  pollMs?: number;
  isLoggedIn: () => Promise<boolean>;
  isManualVerificationVisible: (url: string) => Promise<boolean>;
  isLoginFormVisible?: () => Promise<boolean>;
  getLoginError?: () => Promise<string | null>;
  beforeCheck?: () => Promise<void>;
  shouldAbort?: (url: string) => Promise<string | null> | string | null;
  allowManualLoginFromStart?: boolean;
  ignoreLoginErrors?: boolean;
};

export function getManualActionTimeoutMs() {
  return Number(process.env.MANUAL_ACTION_TIMEOUT_MS ?? 600000);
}

export async function waitForLoginWithManualFallback({
  page,
  platform,
  normalTimeoutMs = 90000,
  pollMs = 500,
  isLoggedIn,
  isManualVerificationVisible,
  isLoginFormVisible,
  getLoginError,
  beforeCheck,
  shouldAbort,
  allowManualLoginFromStart = false,
  ignoreLoginErrors = false,
}: ManualLoginFallbackOptions) {
  const normalDeadline = Date.now() + normalTimeoutMs;
  let manualDeadline: number | null = null;
  let manualActionLogged = false;
  let manualWasVisible = false;
  let manualClearedLogged = false;
  let manualLoginFallbackLogged = false;
  let ignoredLoginErrorLogged = false;

  while (Date.now() < (manualDeadline ?? normalDeadline)) {
    const url = page.url();
    const abortReason = await shouldAbort?.(url);

    if (abortReason) {
      throw new Error(abortReason);
    }

    const loginError = await getLoginError?.();
    if (loginError) {
      if (!ignoreLoginErrors) throw new Error(`${platform} login error: ${loginError}`);
      manualDeadline ??= Date.now() + getManualActionTimeoutMs();
      if (!ignoredLoginErrorLogged) {
        ignoredLoginErrorLogged = true;
        console.log(
          `${platform} login page is showing: ${loginError}. Complete login manually in the visible browser; publishing will keep waiting for up to ${Math.round(
            getManualActionTimeoutMs() / 1000,
          )} seconds.`,
        );
      }
    }

    await beforeCheck?.();

    if (await isLoggedIn()) {
      console.log(`${platform} login confirmed.`);
      return;
    }

    const loginFormVisible = isLoginFormVisible ? await isLoginFormVisible() : false;
    const manualVisible = await isManualVerificationVisible(url);

    if (allowManualLoginFromStart) {
      if (!manualLoginFallbackLogged) {
        manualDeadline = Date.now() + getManualActionTimeoutMs();
        manualLoginFallbackLogged = true;
        console.log(
          `Complete the full ${platform} login manually in the visible browser; publishing will resume after the account opens. Waiting up to ${Math.round(
            getManualActionTimeoutMs() / 1000,
          )} seconds.`,
        );
      }
    } else if (manualVisible) {
      if (!manualActionLogged) {
        manualDeadline = Date.now() + getManualActionTimeoutMs();
        manualActionLogged = true;
        manualWasVisible = true;
        console.log(
          `${platform} needs manual verification. Complete it in the visible browser; publishing will resume automatically for up to ${Math.round(
            getManualActionTimeoutMs() / 1000,
          )} seconds.`,
        );
      }
    } else if (manualWasVisible && !manualClearedLogged) {
      manualClearedLogged = true;
      manualDeadline ??= Date.now() + getManualActionTimeoutMs();
      console.log(`${platform} verification screen cleared. Waiting for ${platform} to finish login...`);
    } else if (manualWasVisible && loginFormVisible) {
      if (!manualLoginFallbackLogged) {
        manualLoginFallbackLogged = true;
        manualDeadline ??= Date.now() + getManualActionTimeoutMs();
        console.log(
          `${platform} still shows the login form after verification. Complete the full ${platform} login manually in the visible browser; publishing will resume after the account opens.`,
        );
      }
    }

    await page.waitForTimeout(pollMs);
  }

  throw new Error(`${platform} login/manual verification did not finish in time.`);
}
