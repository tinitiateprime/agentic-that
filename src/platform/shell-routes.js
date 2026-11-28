// Signed-in screens load inside one frame: the main menu stays put on
// /workspace/<screen>, and each screen loads in an iframe beside it.
// Shared by the middleware, the frame host and the pages inside the frame,
// so it must stay free of server-only imports.

export const HOST_PREFIX = "/workspace";

// Screens that show the main menu. Each entry also covers its sub-pages.
const SHELL_PREFIXES = [
  "/apps",
  "/config-manager",
  "/messaging",
  "/dashboard",
  "/messages",
  "/contacts",
  "/groups",
  "/settings",
  "/console",
  "/publishing",
  "/contact-master",
  "/group-manager",
  "/content-manager",
  "/social-manager",
  "/social-seo",
  "/workspace-reports",
  "/workspace-team",
  "/companion",
  "/admin-center",
  "/project-management",
  "/website-studio",
  "/phone-front-desk",
  "/scraper",
];

// Public pages under those prefixes.
const PUBLIC_PATHS = ["/publishing/privacy"];

const matches = (pathname, prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`);

export function isShellPath(pathname) {
  if (typeof pathname !== "string") return false;
  if (PUBLIC_PATHS.some((path) => matches(pathname, path))) return false;
  return SHELL_PREFIXES.some((prefix) => matches(pathname, prefix));
}

// Runs in <head> before the page paints. Inside the frame it marks <html> so the
// page hides its own copy of the main menu; a page that isn't a workspace screen
// (sign-in, the home page after signing out) leaves the frame instead.
export const frameBootScript = `(function(){try{if(window.self===window.top)return;var d=document.documentElement;d.setAttribute("data-framed","");var p=location.pathname,m=function(x){return p===x||p.indexOf(x+"/")===0};var pub=${JSON.stringify(PUBLIC_PATHS)},sh=${JSON.stringify(SHELL_PREFIXES)};if(pub.some(m)||!sh.some(m))window.top.location.replace(location.href);}catch(e){}})();`;
