import { redirect } from "next/navigation";
import { getCurrentPrincipal } from "@platform/server/access-control";
import "../access-state.css";

export const metadata = { title: "Access denied - AgenticThat" };

export default async function AccessDeniedPage({ searchParams }) {
  const principal = await getCurrentPrincipal();
  if (!principal) redirect("/?auth=login&next=/apps");
  if (principal.status === "pending") redirect("/pending-approval");
  const params = await searchParams;
  const trialExpired = principal.billingStatus === "expired";
  return (
    <main className="access-state-page">
      <section className="access-state-card">
        <a className="access-state-brand" href="/apps">AT <span>AgenticThat</span></a>
        <p className="access-state-kicker">{trialExpired ? "Trial expired" : "Access not selected"}</p>
        <h1>{trialExpired ? "Your free trial has ended." : "This module is not in your selected access."}</h1>
        <p>{trialExpired
          ? "Your selected roles are inactive until a successful payment activates them."
          : "Regular-user roles are selected during onboarding and activated by trial or payment status; administrators do not assign them."}</p>
        <dl>
          <div><dt>Resource</dt><dd>{params?.resource || "Requested module"}</dd></div>
          <div><dt>Required level</dt><dd>{params?.level || "view"}</dd></div>
        </dl>
        <a className="access-state-action" href="/apps">Return to the app store</a>
      </section>
    </main>
  );
}
