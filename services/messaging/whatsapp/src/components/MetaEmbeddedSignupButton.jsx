"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Meta's Embedded Signup coexistence flow. The login, number selection and
// WhatsApp Business app confirmation all happen on Meta's domain. This
// component only receives a short-lived authorization code and the WABA /
// phone-number ids emitted by the popup.
// Docs: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview
export default function MetaEmbeddedSignupButton({ appId, configId, onSuccess }) {
  const router = useRouter();
  const [sdkReady, setSdkReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [result, setResult] = useState(null);
  const signupInfo = useRef({ wabaId: null, phoneNumberId: null });
  const signupInfoWaiter = useRef(null);

  useEffect(() => {
    if (!appId) return;

    window.fbAsyncInit = () => {
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: "v21.0" });
      setSdkReady(true);
    };

    if (!document.getElementById("facebook-jssdk")) {
      const script = document.createElement("script");
      script.id = "facebook-jssdk";
      script.src = "https://connect.facebook.net/en_US/sdk.js";
      script.async = true;
      script.defer = true;
      script.crossOrigin = "anonymous";
      document.body.appendChild(script);
    } else if (window.FB) {
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: "v21.0" });
      setSdkReady(true);
    }

    // Meta's popup posts the waba_id/phone_number_id here mid-flow, before
    // FB.login's own callback fires with the authorization code.
    function onMessage(event) {
      if (!/^https:\/\/www\.facebook\.com$|^https:\/\/web\.facebook\.com$/.test(event.origin)) return;
      let data = event.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      if (data.type !== "WA_EMBEDDED_SIGNUP") return;
      if (data.event === "FINISH" || data.event === "FINISH_ONLY_WABA") {
        signupInfo.current = {
          wabaId: data.data?.waba_id || null,
          phoneNumberId: data.data?.phone_number_id || null,
        };
        signupInfoWaiter.current?.(signupInfo.current);
        signupInfoWaiter.current = null;
      } else if (data.event === "CANCEL") {
        setConnecting(false);
        setResult({
          error: `Signup was closed${data.data?.current_step ? ` at “${data.data.current_step}”` : ""}. No changes were made.`,
        });
      } else if (data.event === "ERROR") {
        setConnecting(false);
        setResult({ error: data.data?.error_message || "Meta reported an error during signup." });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [appId]);

  function waitForSignupInfo() {
    if (signupInfo.current.wabaId) return Promise.resolve(signupInfo.current);
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        signupInfoWaiter.current = null;
        resolve(signupInfo.current);
      }, 5000);
      signupInfoWaiter.current = (info) => {
        window.clearTimeout(timeout);
        resolve(info);
      };
    });
  }

  // The actual async work, kept OUT of the FB.login callback: the FB SDK
  // type-checks that callback and rejects an async function outright
  // ("Expression is of type asyncfunction, not function"), so the callback
  // must be a plain function that just hands off to this.
  async function finishSignup(response) {
    const code = response?.authResponse?.code;
    if (!code) {
      setConnecting(false);
      setResult((r) => r || { error: "Sign-in didn't complete — no authorization code returned." });
      return;
    }
    const info = await waitForSignupInfo();
    if (!info.wabaId) {
      setConnecting(false);
      setResult({ error: "Signed in, but didn't receive a WABA id from the popup. Try again." });
      return;
    }
    const res = await fetch("/api/meta/embedded-signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, wabaId: info.wabaId, phoneNumberId: info.phoneNumberId }),
    });
    const body = await res.json().catch(() => ({}));
    setConnecting(false);
    if (!res.ok) {
      setResult({ error: body.error || "Save failed" });
      return;
    }
    setResult({ numbers: body.numbers || [] });
    onSuccess?.(body);
    router.refresh();
  }

  function launch() {
    if (!window.FB) return;
    signupInfo.current = { wabaId: null, phoneNumberId: null };
    setResult(null);
    setConnecting(true);

    window.FB.login(
      (response) => {
        // Plain (non-async) callback — kick off the async work, don't await it.
        finishSignup(response).catch((err) => {
          setConnecting(false);
          setResult({ error: err?.message || "Something went wrong finishing sign-in." });
        });
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: "whatsapp_business_app_onboarding",
          sessionInfoVersion: "3",
        },
      }
    );
  }

  if (!appId || !configId) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
        Embedded Signup is not configured for this workspace. Add{" "}
        <span className="font-mono">META_APP_ID</span> and{" "}
        <span className="font-mono">META_CONFIGURATION_ID</span> to enable it.
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={launch}
        disabled={!sdkReady || connecting}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#1877F2] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#166fe5] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {connecting ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            Waiting for Meta…
          </>
        ) : (
          <>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-current">
              <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.414c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.973h-1.513c-1.49 0-1.956.93-1.956 1.887v2.26h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073Z" />
            </svg>
            Continue with Facebook
          </>
        )}
      </button>
      <p className="mt-2 text-xs text-slate-500">
        Opens Meta&apos;s secure signup. Your Facebook login and WhatsApp confirmation are never
        shared with us.
      </p>
      <div aria-live="polite">
        {result?.error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{result.error}</p>
        )}
      </div>
      {result?.numbers && (
        <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <span className="font-semibold">Connected.</span>{" "}
          {result.numbers.length} number{result.numbers.length === 1 ? "" : "s"} found:{" "}
          {result.numbers.map((n) => n.display_number || n.phone_number_id).join(", ")}
        </div>
      )}
    </div>
  );
}
