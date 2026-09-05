import { headers } from "next/headers";
import CompanionDownload from "@platform/CompanionDownload";
import ProductShell from "@platform/ProductShell";
import { detectCompanionDevice } from "@platform/companion-device";
import { getCurrentPrincipal } from "@platform/server/access-control";
import { getCompanionRelease } from "@platform/server/companion-releases";

export const metadata = {
  title: "Download AgenticThat Companion",
  description: "Install AgenticThat Companion for Windows, macOS, or Linux.",
};

async function currentPrincipal() {
  try {
    return await getCurrentPrincipal();
  } catch {
    return null;
  }
}

export default async function CompanionDownloadPage() {
  const [requestHeaders, principal, release] = await Promise.all([
    headers(),
    currentPrincipal(),
    getCompanionRelease(),
  ]);
  const signedIn = Boolean(principal && principal.status === "active");
  const view = (
    <CompanionDownload
      release={release}
      initialDevice={detectCompanionDevice(requestHeaders.get("user-agent"))}
      signedIn={signedIn}
    />
  );

  // Signed-in workspaces get the download inside the product shell; the page stays
  // publicly reachable so Companion itself can link people back to a newer build.
  if (!signedIn) return view;

  return (
    <ProductShell
      user={{
        id: principal.userId,
        name: principal.name,
        email: principal.email,
        businessName: principal.businessName,
        isGlobalAdmin: principal.isGlobalAdmin,
        billingStatus: principal.billingStatus,
        trialStartsAt: principal.trialStartsAt,
        trialEndsAt: principal.trialEndsAt,
        capabilities: principal.capabilities,
      }}
      active="companion"
      companionBridge={false}
    >
      {view}
    </ProductShell>
  );
}
