import { redirect } from "next/navigation";
import { getCurrentPrincipal } from "@platform/server/access-control";
import "../access-state.css";

export const metadata = { title: "Approval pending - AgenticThat" };

export default async function PendingApprovalPage() {
  const principal = await getCurrentPrincipal();
  if (!principal) redirect("/?auth=login&next=/pending-approval");
  if (principal.status === "active") redirect("/apps");

  return (
    <main className="access-state-page">
      <section className="access-state-card">
        <a className="access-state-brand" href="/">AT <span>AgenticThat</span></a>
        <p className="access-state-kicker">Account review</p>
        <h1>{principal.status === "pending" ? "Your access request is pending." : "This account is not active."}</h1>
        <p>
          {principal.status === "pending"
            ? "This is a legacy pending account. A global administrator must activate the identity; roles remain self-selected and billing-controlled."
            : "Contact an AgenticThat administrator if you believe this account status is incorrect."}
        </p>
        <dl>
          <div><dt>User</dt><dd>{principal.name}</dd></div>
          <div><dt>Email</dt><dd>{principal.email}</dd></div>
          <div><dt>Status</dt><dd>{principal.status}</dd></div>
        </dl>
        <form action="/api/platform-auth/logout" method="post"><button type="submit">Sign out</button></form>
      </section>
    </main>
  );
}
