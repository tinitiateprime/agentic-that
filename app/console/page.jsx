import { createServiceIdentityToken } from "@platform/server/auth-store";
import { requireAccess } from "@platform/server/access-control";
import TelegramConsoleClient from "./TelegramConsoleClient";

export const metadata = { title: "Telegram Console - AgenticThat" };

export default async function TelegramConsolePage() {
  const principal = await requireAccess("messaging.telegram", "view", "/console");
  return (
    <>
      <link rel="stylesheet" href="/console/styles.css" />
      <TelegramConsoleClient serviceToken={await createServiceIdentityToken(principal, "telegram")} />
    </>
  );
}
