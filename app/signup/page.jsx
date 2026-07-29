import { redirect } from "next/navigation";
import { getCurrentPlatformUser } from "@platform/server/auth-store";

export const metadata = { title: "Create account - AgenticThat" };

export default async function SignupPage() {
  if (await getCurrentPlatformUser()) redirect("/apps");
  redirect("/?auth=signup&next=/apps");
}
