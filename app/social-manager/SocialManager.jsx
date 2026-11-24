"use client";

import { BarChart3, Inbox } from "lucide-react";
import { useState } from "react";
import AnalyticsView from "./AnalyticsView";

export default function SocialManager({ workspaceName, initialReport }) {
  const [tab, setTab] = useState("analytics");
  return (
    <main className="sm-shell">
      <header className="sm-header">
        <p>Social Manager</p>
        <h1>{workspaceName || "Your company"}</h1>
        <span>How your posts perform on every platform, in one place.</span>
      </header>
      <nav className="sm-tabs" role="tablist" aria-label="Social Manager">
        <button type="button" role="tab" aria-selected={tab === "analytics"} onClick={() => setTab("analytics")}><BarChart3 size={16} />Analytics</button>
        <button type="button" role="tab" aria-selected={tab === "inbox"} onClick={() => setTab("inbox")}><Inbox size={16} />Inbox <em>Coming next</em></button>
      </nav>
      {tab === "analytics" ? <AnalyticsView initialReport={initialReport} /> : (
        <section className="sm-panel sm-coming">
          <Inbox size={26} />
          <h2>Unified inbox is coming next</h2>
          <p>Comments, replies, mentions and messages from Instagram, Facebook, YouTube, LinkedIn and X in one list, read from each platform&apos;s notification emails, with assign, mark done and one-tap reply in the app.</p>
        </section>
      )}
    </main>
  );
}
