import { redirect } from "next/navigation";
import ShellHost from "@platform/ShellHost";
import { getCurrentPrincipal } from "@platform/server/access-control";
import { isShellPath } from "@platform/shell-routes";

export const metadata = { title: "AgenticThat" };
export const dynamic = "force-dynamic";

// /workspace/<screen>: the main menu with <screen> loaded in an iframe beside it.
export default async function WorkspaceFramePage({ params, searchParams }) {
  const { path = [] } = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries((await searchParams) || {})) {
    for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
  }
  const pathname = path.length ? `/${path.map(encodeURIComponent).join("/")}` : "/apps";
  const target = `${pathname}${query.size ? `?${query}` : ""}`;

  if (!isShellPath(pathname)) redirect(target);
  const principal = await getCurrentPrincipal();
  if (!principal) redirect(`/?auth=login&next=${encodeURIComponent(target)}`);

  return <ShellHost user={principal} initialPath={target} />;
}
