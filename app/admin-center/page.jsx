import { requireGlobalAdmin } from "@platform/server/access-control";
import ProductShell from "@platform/ProductShell";
import AdminCenter from "./AdminCenter";
import "./admin-center.css";
import "./email-studio.css";
import "./publishing-monitor.css";
import "@project-workspace/embedded/styles.css";

export const metadata = { title: "Admin Center - AgenticThat" };
export const dynamic = "force-dynamic";

export default async function AdminCenterPage() {
  const principal = await requireGlobalAdmin();
  return (
    <ProductShell user={principal} active="admin" companionBridge={false} embedded>
      <AdminCenter initialData={null} principal={principal} />
    </ProductShell>
  );
}
