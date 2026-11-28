// Next.js instrumentation. onRequestError runs for every error thrown while
// handling a request — API routes, page and server-component rendering,
// server actions and middleware — and records it in the error log
// (lib/error-log.js, table agentic_that.app_error_log).

export async function register() {}

export async function onRequestError(error, request, context) {
  // The error log talks to Postgres, which only the Node.js runtime can do.
  // Keep the import inside this exact check: Next.js replaces NEXT_RUNTIME at
  // build time, so the Edge build (used by middleware.js) drops it entirely.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { logRequestError } = await import("./lib/error-log.js");
      await logRequestError(error, request, context);
    } catch {
      // Logging must never cause a second failure.
    }
  }
}
