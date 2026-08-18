import { redirect } from "next/navigation";
import { getCurrentPrincipal } from "@platform/server/access-control";

export const metadata = { title: "Create your workspace — Tinitiate WA" };

export default async function SignupPage() {
  const principal = await getCurrentPrincipal();
  if (principal?.status === "pending") redirect("/pending-approval");
  if (principal) redirect("/dashboard");
  redirect("/?auth=signup&next=/dashboard");
}
