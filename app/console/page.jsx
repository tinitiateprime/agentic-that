import { createServiceIdentityToken } from "@platform/server/auth-store";
import { requireAccess, requireCapability } from "@platform/server/access-control";
import "@telegram/public/styles.css";
import TelegramConsoleClient from "./TelegramConsoleClient";

export const metadata = { title: "Telegram Console - AgenticThat" };

export default async function TelegramConsolePage() {
  await requireAccess("messaging.telegram", "view", "/console");
  const principal = await requireCapability("messaging.view", "/console");
  return (
    <TelegramConsoleClient serviceToken={await createServiceIdentityToken(principal, "telegram")} />
  );
}
