import { redirect } from "next/navigation";
import { getCurrentPrincipal } from "@platform/server/access-control";

export const metadata = { title: "Sign in — Tinitiate WA" };

export default async function LoginPage() {
  const principal = await getCurrentPrincipal();
  if (principal?.status === "pending") redirect("/pending-approval");
  if (principal) redirect("/dashboard");
  redirect("/?auth=login&next=/dashboard");
}
