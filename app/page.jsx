import PlatformHome from "@platform/PlatformHome";
import { getCurrentPlatformUser } from "@platform/server/auth-store";
import { redirect } from "next/navigation";

export const viewport = {
  themeColor: "#02060d",
};

function safeNextPath(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "";
}

export default async function HomePage({ searchParams }) {
  const params = await searchParams;
  const user = await getCurrentPlatformUser();
  const nextPath = safeNextPath(params?.next);
  if (user && nextPath) redirect(nextPath);

  return (
    <PlatformHome
      initialUser={user ? { id: user.id, name: user.name, email: user.email } : null}
      initialAuthMode={params?.auth === "signup" ? "signup" : params?.auth === "login" ? "login" : ""}
      initialNextPath={nextPath}
    />
  );
}
