import { NextResponse } from "next/server";
import { HOST_PREFIX, isShellPath } from "@platform/shell-routes";

const attribute = (value) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Opening a workspace screen directly (typed URL, bookmark, reload, sign-in
// redirect) goes to the frame host, which loads that screen in its iframe.
// Only full page loads are moved: the iframe's own request has
// Sec-Fetch-Dest "iframe", and in-app navigations are data fetches.
export function middleware(request) {
  if (request.method !== "GET" || request.headers.get("sec-fetch-dest") !== "document") return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (!isShellPath(pathname)) return NextResponse.next();

  // A relative redirect page rather than a 307: Next rewrites an absolute Location
  // that points at itself to the host it was started on (localhost for 127.0.0.1
  // in development), which loses the session cookie. This also keeps any #section.
  const target = `${HOST_PREFIX}${pathname}${search}`;
  const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${attribute(target)}"><script>location.replace(${JSON.stringify(target).replace(/</g, "\\u003c")}+location.hash)</script>`;
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export const config = {
  matcher: ["/((?!api|_next|workspace/|.*\\..*).*)"],
};
