"use client";

import { useEffect, useRef, useState } from "react";

const EMPTY_FORM = {
  name: "",
  businessName: "",
  email: "",
  password: "",
  confirmPassword: "",
  selectedRoleIds: [],
};

const SIGNUP_STEPS = [
  { id: 1, shortLabel: "Account", eyebrow: "Step 1 of 4", title: "Tell us about yourself", description: "Create the account that will own your AgenticThat workspace." },
  { id: 2, shortLabel: "Roles", eyebrow: "Step 2 of 4", title: "Choose your access", description: "Select the modules you want to use during your free trial." },
  { id: 3, shortLabel: "Trial / pay", eyebrow: "Step 3 of 4", title: "Start with a free trial", description: "Review your access. No payment method is required to get started." },
  { id: 4, shortLabel: "Success", eyebrow: "Setup complete", title: "Your workspace is ready", description: "Your selected modules are now available in AgenticThat." },
];

const FULL_ACCESS_ROLE_ID = "role_self_full_access";

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export default function AuthModal({ open, initialMode = "login", onClose, onAuthenticated }) {
  const firstInputRef = useRef(null);
  const stepHeadingRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const onAuthenticatedRef = useRef(onAuthenticated);
  const completedUserRef = useRef(null);
  const [mode, setMode] = useState(initialMode === "signup" ? "signup" : "login");
  const [form, setForm] = useState(EMPTY_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [roleOptions, setRoleOptions] = useState([]);
  const [trialDays, setTrialDays] = useState(7);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [signupStep, setSignupStep] = useState(1);
  const [completedUser, setCompletedUser] = useState(null);

  useEffect(() => {
    onCloseRef.current = onClose;
    onAuthenticatedRef.current = onAuthenticated;
  }, [onClose, onAuthenticated]);

  useEffect(() => {
    completedUserRef.current = completedUser;
  }, [completedUser]);

  useEffect(() => {
    if (!open) return undefined;
    setMode(initialMode === "signup" ? "signup" : "login");
    setSignupStep(1);
    setCompletedUser(null);
    completedUserRef.current = null;
    setError("");
    setBusy(false);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => firstInputRef.current?.focus(), 80);
    const handleKeyDown = (event) => {
      if (event.key !== "Escape") return;
      const authenticatedUser = completedUserRef.current;
      if (authenticatedUser) {
        completedUserRef.current = null;
        onAuthenticatedRef.current?.(authenticatedUser);
        return;
      }
      onCloseRef.current?.();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, initialMode]);

  useEffect(() => {
    if (!open || mode !== "signup") return;
    let active = true;
    setRolesLoading(true);
    fetch("/api/platform-auth/signup-options", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Access options are unavailable.");
        if (active) {
          setRoleOptions(Array.isArray(data.roles) ? data.roles : []);
          setTrialDays(Number(data.trialDays) || 7);
        }
      })
      .catch((loadError) => { if (active) setError(loadError.message); })
      .finally(() => { if (active) setRolesLoading(false); });
    return () => { active = false; };
  }, [open, mode]);

  useEffect(() => {
    if (!open || mode !== "signup" || signupStep === 1) return;
    stepHeadingRef.current?.focus();
  }, [open, mode, signupStep]);

  if (!open) return null;

  const isSignup = mode === "signup";
  const activeStep = SIGNUP_STEPS[signupStep - 1];
  const selectedRoles = roleOptions.filter((role) => form.selectedRoleIds.includes(role.id));
  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  const changeMode = (nextMode) => {
    if (busy || completedUser) return;
    setMode(nextMode);
    setSignupStep(1);
    setError("");
  };

  const goToStep = (step) => {
    setError("");
    setSignupStep(step);
  };

  const toggleRole = (roleId) => {
    setForm((current) => {
      if (roleId === FULL_ACCESS_ROLE_ID) {
        return {
          ...current,
          selectedRoleIds: current.selectedRoleIds.includes(roleId) ? [] : [roleId],
        };
      }

      const withoutFullAccess = current.selectedRoleIds.filter((id) => id !== FULL_ACCESS_ROLE_ID);
      return {
        ...current,
        selectedRoleIds: withoutFullAccess.includes(roleId)
          ? withoutFullAccess.filter((id) => id !== roleId)
          : [...withoutFullAccess, roleId],
      };
    });
    setError("");
  };

  function validateAccountDetails() {
    if (form.name.trim().length < 2) return "Enter your full name.";
    if (form.businessName.trim().length < 2) return "Enter your company or workspace name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return "Enter a valid work email.";
    if (form.password.length < 8) return "Password must contain at least 8 characters.";
    if (form.password !== form.confirmPassword) return "Passwords do not match.";
    return "";
  }

  function finishSignup() {
    if (!completedUser) return;
    const authenticatedUser = completedUser;
    completedUserRef.current = null;
    setCompletedUser(null);
    setForm(EMPTY_FORM);
    setSignupStep(1);
    onAuthenticated?.(authenticatedUser);
  }

  function requestClose() {
    if (busy) return;
    if (completedUser) {
      finishSignup();
      return;
    }
    onClose?.();
  }

  async function submit(event) {
    event.preventDefault();
    setError("");

    if (!isSignup) {
      setBusy(true);
      try {
        const response = await fetch("/api/platform-auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: form.email, password: form.password }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Unable to continue. Please try again.");
        setForm(EMPTY_FORM);
        onAuthenticated?.(data.user);
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : "Unable to continue. Please try again.");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (signupStep === 1) {
      const validationError = validateAccountDetails();
      if (validationError) {
        setError(validationError);
        return;
      }
      goToStep(2);
      return;
    }

    if (signupStep === 2) {
      if (!form.selectedRoleIds.length) {
        setError("Choose at least one access role for your free trial.");
        return;
      }
      goToStep(3);
      return;
    }

    if (signupStep === 4) {
      finishSignup();
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/platform-auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to continue. Please try again.");
      setCompletedUser(data.user);
      completedUserRef.current = data.user;
      setSignupStep(4);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to continue. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="auth-overlay"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && requestClose()}
    >
      <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="auth-close" type="button" aria-label="Close" onClick={requestClose} disabled={busy}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>

        <aside className="auth-story">
          <div className="auth-story-brand"><span>AT</span> AgenticThat</div>
          <div className="auth-story-copy">
            <p className="auth-eyebrow">One intelligent workspace</p>
            <h2>Move from idea to automated operation.</h2>
            <p>Access messaging, scraping, publishing, and engagement workflows from one secure account.</p>
          </div>
          <div className="auth-assurances" aria-label="Platform benefits">
            <span><i /> Private workspace</span>
            <span><i /> Connected services</span>
            <span><i /> Enterprise-ready access</span>
          </div>
        </aside>

        <div className="auth-form-panel">
          <div className="auth-mode-switch" aria-label="Authentication mode">
            <button type="button" className={!isSignup ? "active" : ""} onClick={() => changeMode("login")} disabled={Boolean(completedUser)}>Sign in</button>
            <button type="button" className={isSignup ? "active" : ""} onClick={() => changeMode("signup")} disabled={Boolean(completedUser)}>Create account</button>
          </div>

          {isSignup && (
            <ol className="auth-stepper" aria-label="Account setup progress">
              {SIGNUP_STEPS.map((step) => (
                <li
                  className={`${signupStep === step.id ? "active" : ""}${signupStep > step.id ? " complete" : ""}`}
                  key={step.id}
                  aria-current={signupStep === step.id ? "step" : undefined}
                >
                  <span>{signupStep > step.id ? "✓" : step.id}</span>
                  <small>{step.shortLabel}</small>
                </li>
              ))}
            </ol>
          )}

          <header className="auth-heading" ref={stepHeadingRef} tabIndex={isSignup && signupStep > 1 ? -1 : undefined}>
            <p>{isSignup ? activeStep.eyebrow : "Welcome back"}</p>
            <h1 id="auth-title">{isSignup ? activeStep.title : "Sign in to continue"}</h1>
            <span>{isSignup ? activeStep.description : "Use your account to open AgenticThat services."}</span>
          </header>

          <form className="auth-form" onSubmit={submit}>
            {(!isSignup || signupStep === 1) && (
              <>
                {isSignup && (
                  <div className="auth-field-row">
                    <label className="auth-field">
                      <span>Full name</span>
                      <input ref={firstInputRef} value={form.name} onChange={update("name")} autoComplete="name" placeholder="Your name" minLength={2} maxLength={80} required />
                    </label>
                    <label className="auth-field">
                      <span>Company</span>
                      <input value={form.businessName} onChange={update("businessName")} autoComplete="organization" placeholder="Workspace name" minLength={2} maxLength={120} required />
                    </label>
                  </div>
                )}

                <label className="auth-field">
                  <span>Work email</span>
                  <input ref={isSignup ? undefined : firstInputRef} type="email" value={form.email} onChange={update("email")} autoComplete="email" placeholder="name@company.com" maxLength={254} required />
                </label>

                <label className="auth-field">
                  <span>Password</span>
                  <div className="auth-password-field">
                    <input type={showPassword ? "text" : "password"} value={form.password} onChange={update("password")} autoComplete={isSignup ? "new-password" : "current-password"} placeholder={isSignup ? "At least 8 characters" : "Enter your password"} minLength={8} maxLength={128} required />
                    <button type="button" onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? "Hide" : "Show"}</button>
                  </div>
                </label>

                {isSignup && (
                  <label className="auth-field">
                    <span>Confirm password</span>
                    <input type={showPassword ? "text" : "password"} value={form.confirmPassword} onChange={update("confirmPassword")} autoComplete="new-password" placeholder="Repeat your password" minLength={8} maxLength={128} required />
                  </label>
                )}
              </>
            )}

            {isSignup && signupStep === 2 && (
              <fieldset className="auth-role-picker">
                <legend>Choose trial access</legend>
                <p>Select individual module roles or Full Access. You can update your selection when the payment flow is available.</p>
                {rolesLoading ? <span className="auth-role-loading">Loading access options…</span> : roleOptions.map((role) => (
                  <label className={form.selectedRoleIds.includes(role.id) ? "selected" : ""} key={role.id}>
                    <input type="checkbox" checked={form.selectedRoleIds.includes(role.id)} onChange={() => toggleRole(role.id)} />
                    <span><strong>{role.name}</strong><small>{role.description}</small></span>
                  </label>
                ))}
              </fieldset>
            )}

            {isSignup && signupStep === 3 && (
              <div className="auth-plan-step">
                <div className="auth-plan-card selected">
                  <div className="auth-plan-card-head">
                    <span className="auth-plan-check">✓</span>
                    <div><strong>{trialDays}-day free trial</strong><small>Selected</small></div>
                  </div>
                  <p>Use all selected modules now. No card is required. Access pauses when the trial ends unless payment is completed.</p>
                  <div className="auth-selected-roles" aria-label="Selected roles">
                    {selectedRoles.map((role) => <span key={role.id}>{role.name}</span>)}
                  </div>
                </div>
                <div className="auth-plan-card disabled" aria-disabled="true">
                  <div className="auth-plan-card-head">
                    <span className="auth-plan-payment-icon" aria-hidden="true">₹</span>
                    <div><strong>Activate paid access</strong><small>Payment gateway coming soon</small></div>
                  </div>
                  <p>Once connected, successful payment will keep your selected roles active after the trial.</p>
                </div>
                <p className="auth-plan-note"><span>✓</span> You will not be charged during signup.</p>
              </div>
            )}

            {isSignup && signupStep === 4 && (
              <div className="auth-success" role="status">
                <div className="auth-success-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg>
                </div>
                <strong>Welcome, {completedUser?.name || form.name}.</strong>
                <p>Your {trialDays}-day trial is active for {selectedRoles.map((role) => role.name).join(", ")}.</p>
                {formatDate(completedUser?.trialEndsAt) && (
                  <span>Trial access continues through {formatDate(completedUser.trialEndsAt)}.</span>
                )}
              </div>
            )}

            <div className={`auth-error${error ? " visible" : ""}`} role="alert">{error || " "}</div>

            <div className={`auth-actions${isSignup && signupStep > 1 && signupStep < 4 ? " has-back" : ""}`}>
              {isSignup && signupStep > 1 && signupStep < 4 && (
                <button className="auth-back" type="button" onClick={() => goToStep(signupStep - 1)} disabled={busy}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m5 5-5-5 5-5" /></svg>
                  Back
                </button>
              )}

              <button className="auth-submit" type="submit" disabled={busy || (isSignup && signupStep === 2 && rolesLoading)}>
                <span>{busy
                  ? "Creating your workspace..."
                  : !isSignup
                    ? "Continue to AgenticThat"
                    : signupStep === 1
                      ? "Continue to roles"
                      : signupStep === 2
                        ? "Review free trial"
                        : signupStep === 3
                          ? `Start ${trialDays}-day free trial`
                          : "Open my workspace"}</span>
                {!busy && <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5" /></svg>}
              </button>
            </div>
          </form>

          {(!isSignup || signupStep < 4) && <p className="auth-legal">By continuing, you agree to the Terms of Service and Privacy Policy.</p>}
        </div>
      </section>
    </div>
  );
}
