"use client";

import { BarChart3, Inbox } from "lucide-react";
import { useEffect, useState } from "react";
import { CompanyTile } from "@platform/CompanySwitcher";
import AnalyticsView from "./AnalyticsView";
import InboxView from "./InboxView";

export default function SocialManager({ workspaceName, workspaceId = "", initialReport }) {
  const [tab, setTab] = useState("analytics");
  const [needsReply, setNeedsReply] = useState(0);
  // The Inbox tab shows how many comments are waiting for a reply.
  useEffect(() => {
    let active = true;
    fetch("/api/social-inbox").then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (active && data?.counts) setNeedsReply(data.counts.open || 0); }).catch(() => {});
    return () => { active = false; };
  }, []);
  return (
    <main className="sm-shell">
      <header className="sm-header">
        <CompanyTile id={workspaceId || workspaceName} name={workspaceName || "Your company"} size={52} />
        <div>
          <p>Social Manager</p>
          <h1>{workspaceName || "Your company"}</h1>
          <span>How your posts perform, and every comment to answer, in one place.</span>
        </div>
      </header>
      <nav className="sm-tabs" role="tablist" aria-label="Social Manager">
        <button type="button" role="tab" aria-selected={tab === "analytics"} onClick={() => setTab("analytics")}><BarChart3 size={16} />Analytics</button>
        <button type="button" role="tab" aria-selected={tab === "inbox"} onClick={() => setTab("inbox")}>
          <Inbox size={16} />Inbox{needsReply > 0 && <em className="sm-tab-count" aria-label={`${needsReply} need a reply`}>{needsReply}</em>}
        </button>
      </nav>
      {tab === "analytics" ? <AnalyticsView initialReport={initialReport} /> : <InboxView onCounts={(counts) => setNeedsReply(counts?.open || 0)} />}
    </main>
  );
}
