import { redirect } from "next/navigation";
import { getCurrentPlatformUser } from "@platform/server/auth-store";

export const metadata = { title: "Sign in - AgenticThat" };

export default async function LoginPage() {
  if (await getCurrentPlatformUser()) redirect("/apps");
  redirect("/?auth=login&next=/apps");
}
