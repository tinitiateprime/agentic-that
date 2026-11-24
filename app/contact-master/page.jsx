import ProductShell from "@platform/ProductShell";
import ContactsWorkspace from "@platform/group-manager/ContactsWorkspace";
import { requireOpenServicePrincipal } from "@platform/server/access-control";
import { listSuperAdminUsernames } from "@platform/server/audit-directory";

export const metadata = {
  title: "Contacts — AgenticThat",
  description: "Keep every contact's WhatsApp, Telegram, Discord, Messenger, Instagram and X in one place, shared with your groups.",
};

export const dynamic = "force-dynamic";

// Contacts is Contact Master on its own page; the same list appears in Groups.
export default async function ContactsPage() {
  const principal = await requireOpenServicePrincipal("/contact-master");
  return (
    <ProductShell user={principal} active="contacts" companionBridge={false}>
      <main>
        <ContactsWorkspace workspaceName={principal.businessName || ""} superAdmins={await listSuperAdminUsernames()} />
      </main>
    </ProductShell>
  );
}
