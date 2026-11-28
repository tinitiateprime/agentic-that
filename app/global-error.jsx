"use client";

import { useEffect } from "react";

// Reports the error to the application error log (POST /api/error-log/client).
// Server errors are already recorded by instrumentation.js with the same
// digest, so the reference shown here matches the logged row.
function reportClientError(error) {
  try {
    const payload = JSON.stringify({
      kind: "global-error",
      name: error?.name || "Error",
      message: error?.message || "Unknown error",
      stack: error?.stack || null,
      digest: error?.digest || null,
      path: window.location.pathname,
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/error-log/client", new Blob([payload], { type: "application/json" }));
    } else {
      fetch("/api/error-log/client", { method: "POST", body: payload, keepalive: true }).catch(() => {});
    }
  } catch {
    // Reporting must never break the error page.
  }
}

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            padding: "24px",
            fontFamily: "Arial, sans-serif",
            background: "#f7faf8",
          }}
        >
          <div style={{ textAlign: "center", maxWidth: "420px" }}>
            <h2>Something went wrong</h2>

            <p>
              We couldn't load this page correctly. Please try again.
            </p>

            {error?.digest && (
              <p style={{ fontSize: "12px", color: "#64748b" }}>
                Error reference: <code>{error.digest}</code>
              </p>
            )}

            <button
              type="button"
              onClick={() => reset()}
              style={{
                padding: "10px 18px",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
