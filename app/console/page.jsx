import { createServiceIdentityToken } from "@platform/server/auth-store";
import { requireAccess, requirePrincipalCapability } from "@platform/server/access-control";
import ProductShell from "@platform/ProductShell";
import TelegramConsoleClient from "./TelegramConsoleClient";

export const metadata = { title: "Telegram Console - AgenticThat" };

export default async function TelegramConsolePage() {
  const accessUser = await requireAccess("messaging.telegram", "view", "/console");
  const principal = await requirePrincipalCapability(accessUser, "messaging.view", "/console");
  return (
    <ProductShell user={principal} active="telegram" companionBridge={false} embedded>
      <link rel="stylesheet" href="/telegram-console-assets/styles.css" />
      <TelegramConsoleClient serviceToken={await createServiceIdentityToken(principal, "telegram")} />
    </ProductShell>
  );
}
