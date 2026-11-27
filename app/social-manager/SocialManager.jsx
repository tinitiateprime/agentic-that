"use client";

import { BarChart3, Inbox } from "lucide-react";
import { useState } from "react";
import AnalyticsView from "./AnalyticsView";
import InboxView from "./InboxView";

export default function SocialManager({ workspaceName, initialReport }) {
  const [tab, setTab] = useState("analytics");
  return (
    <main className="sm-shell">
      <header className="sm-header">
        <p>Social Manager</p>
        <h1>{workspaceName || "Your company"}</h1>
        <span>How your posts perform, and every comment to answer, in one place.</span>
      </header>
      <nav className="sm-tabs" role="tablist" aria-label="Social Manager">
        <button type="button" role="tab" aria-selected={tab === "analytics"} onClick={() => setTab("analytics")}><BarChart3 size={16} />Analytics</button>
        <button type="button" role="tab" aria-selected={tab === "inbox"} onClick={() => setTab("inbox")}><Inbox size={16} />Inbox</button>
      </nav>
      {tab === "analytics" ? <AnalyticsView initialReport={initialReport} /> : <InboxView />}
    </main>
  );
}
