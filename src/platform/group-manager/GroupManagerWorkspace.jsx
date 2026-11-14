"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CloudOff, Loader2, MonitorDown, Plus, RefreshCw, UsersRound } from "lucide-react";
import AppLogo, { APPS, MESSAGING_APPS } from "./AppLogo";
import ConnectPanel from "./ConnectPanel";
import ContactMaster from "./ContactMaster";
import GroupDetail from "./GroupDetail";
import NewGroupForm from "./NewGroupForm";
import { companion, companionGroupsStatus, website } from "./companion-groups";
import styles from "./group-manager.module.css";

const STATE_LABELS = { connected: "Connected", connecting: "Connecting…", qr: "Scan the QR code", code: "Enter the code", password: "Enter the password", error: "Needs attention", disconnected: "Not connected" };

/** Work saved on AgenticThat that the apps haven't finished yet. */
function hasPending(group) {
  return Object.values(group.apps).some((status) => status?.state === "creating")
    || group.members.some((member) => Object.values(member.apps).some((status) => status?.state === "pending"))
    || group.messages.some((sent) => Object.values(sent.results).some((result) => result?.state === "sending"));
}

/** The statuses that matter, to tell whether the Companion knows something AgenticThat doesn't yet. */
function differs(reported, saved) {
  if (!saved) return false;
  const key = (value) => JSON.stringify(value ? { s: value.state, d: value.detail || "", l: value.link || "", e: value.error || "" } : null);
  for (const [app, status] of Object.entries(reported.apps || {})) if (key(status) !== key(saved.apps[app])) return true;
  for (const member of reported.members || []) {
    const mine = saved.members.find((entry) => entry.contactId === member.contactId);
    if (!mine) continue;
    for (const [app, status] of Object.entries(member.apps)) if (key(status) !== key(mine.apps[app])) return true;
  }
  for (const sent of reported.messages || []) {
    const mine = saved.messages.find((entry) => entry.id === sent.id);
    if (mine && JSON.stringify(sent.results) !== JSON.stringify(mine.results)) return true;
  }
  return false;
}

export default function GroupManagerWorkspace({ workspaceName = "" }) {
  const [data, setData] = useState(null); // { contacts, groups } from AgenticThat
  const [loadError, setLoadError] = useState("");
  const [companionStatus, setCompanionStatus] = useState({ checking: true, running: false, supported: false });
  const [connections, setConnections] = useState([]);
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [creating, setCreating] = useState(false);
  const [connecting, setConnecting] = useState("");
  const sentJobs = useRef(new Map());
  const synced = useRef(new Map());
  const online = companionStatus.running && companionStatus.supported;

  const loadData = useCallback(async () => {
    try {
      const next = await website.state();
      setData({ contacts: Array.isArray(next.contacts) ? next.contacts : [], groups: Array.isArray(next.groups) ? next.groups : [] });
      setLoadError("");
      return next;
    } catch (failure) {
      setLoadError(failure.message);
      return null;
    }
  }, []);

  /** Hands a group's work to the Companion. Without it, the work waits (saved) until it runs. */
  const dispatch = useCallback(async (group, action = "sync", contactId, contactsList) => {
    const contacts = (contactsList || data?.contacts || []).filter((contact) => group.members.some((member) => member.contactId === contact.id));
    try {
      await companion.run(group, contacts, action, contactId);
      sentJobs.current.set(group.id, Date.now());
      setNotice("");
    } catch (failure) {
      setNotice(failure.offline
        ? "Saved. The AgenticThat Companion isn't running on this computer, so the apps will be updated as soon as it is."
        : failure.message);
    }
  }, [data]);

  const loadCompanion = useCallback(async (saved) => {
    try {
      const state = await companion.state();
      setConnections(Array.isArray(state.connections) ? state.connections : []);
      setCompanionStatus({ checking: false, running: true, supported: true });
      // Results the Companion couldn't report itself (not paired, or offline a moment): copy them.
      const groups = saved?.groups || [];
      const changed = (Array.isArray(state.groups) ? state.groups : []).filter((reported) => differs(reported, groups.find((group) => group.id === reported.id)))
        .filter((reported) => Date.now() - (synced.current.get(reported.id) || 0) > 4000);
      if (changed.length) {
        for (const reported of changed) synced.current.set(reported.id, Date.now());
        await website.sync(changed.map(({ id, apps, members, messages }) => ({ id, apps, members, messages }))).catch(() => undefined);
      }
      // Saved work the Companion doesn't have yet (made while it was closed, or on another device).
      for (const group of groups) {
        if (hasPending(group) && Date.now() - (sentJobs.current.get(group.id) || 0) > 20_000) {
          sentJobs.current.set(group.id, Date.now());
          void companion.run(group, (saved?.contacts || []).filter((contact) => group.members.some((member) => member.contactId === contact.id))).catch(() => undefined);
        }
      }
      return state;
    } catch (failure) {
      if (failure.offline) setCompanionStatus({ checking: false, running: false, supported: false });
      else if (failure.status === 404) setCompanionStatus({ checking: false, running: true, supported: false });
      return null;
    }
  }, []);

  const refresh = useCallback(async () => {
    const saved = await loadData();
    if (online) await loadCompanion(saved);
    return saved;
  }, [loadData, loadCompanion, online]);

  // First load: AgenticThat's data, then find the Companion.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadData();
      const status = await companionGroupsStatus();
      if (cancelled) return;
      setCompanionStatus({ checking: false, ...status });
      if (status.running && status.supported) await loadCompanion(saved);
    })();
    return () => { cancelled = true; };
  }, [loadData, loadCompanion]);

  // Live updates: quick while something is happening, slow otherwise.
  const working = Boolean(data?.groups.some(hasPending)) || connections.some((entry) => ["connecting", "qr"].includes(entry.state)) || Boolean(connecting);
  useEffect(() => {
    const timer = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const saved = await loadData();
      if (online) await loadCompanion(saved);
      else {
        const status = await companionGroupsStatus();
        if (status.running !== companionStatus.running || status.supported !== companionStatus.supported) {
          setCompanionStatus({ checking: false, ...status });
          if (status.running && status.supported) await loadCompanion(saved);
        }
      }
    }, working ? 2000 : 7000);
    return () => clearInterval(timer);
  }, [working, online, companionStatus.running, companionStatus.supported, loadData, loadCompanion]);

  // ---- Actions: save on AgenticThat, then hand the work to the Companion -------------------

  const actions = useMemo(() => ({
    async createGroup(input) {
      const { group } = await website.createGroup(input);
      await loadData();
      await dispatch(group);
      return group;
    },
    async addMembers(group, contactIds) {
      const { group: next } = await website.addMembers(group.id, contactIds);
      await dispatch(next);
    },
    async removeMember(group, contactId) {
      const { group: next, needsCompanion } = await website.removeMember(group.id, contactId);
      if (needsCompanion) await dispatch(next, "remove", contactId);
    },
    async sendMessage(group, text) {
      const { group: next } = await website.sendMessage(group.id, text);
      await dispatch(next);
    },
    async retry(group) {
      await dispatch(group, "retry");
    },
    async deleteGroup(group) {
      await website.deleteGroup(group.id);
      await companion.forget(group.id).catch(() => undefined);
    },
  }), [dispatch, loadData]);

  const groups = useMemo(() => data?.groups || [], [data]);
  const contacts = data?.contacts || [];
  const selected = groups.find((group) => group.id === selectedId) || (!creating ? groups[0] : null);
  const anyConnected = connections.some((entry) => entry.state === "connected");

  // A connection that finished closes its panel by itself (e.g. after scanning the QR code).
  const connectingState = connections.find((entry) => entry.app === connecting)?.state;
  useEffect(() => {
    if (connecting && connecting !== "discord" && connectingState === "connected") {
      const timer = setTimeout(() => setConnecting(""), 1200);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [connecting, connectingState]);

  if (!data && !loadError) {
    return <div className={styles.page}><p className={styles.muted}><Loader2 size={16} className={styles.spin} /> Loading your groups…</p></div>;
  }

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <div>
          <span className={styles.eyebrow}><UsersRound size={14} /> Group Manager</span>
          <h1>Your groups, in every app</h1>
          <p>Create a group once and it&apos;s made in your real WhatsApp, Telegram, Discord, Messenger and Instagram. Add people from Contact Master and they&apos;re added there too; message everyone in one go.</p>
        </div>
      </header>

      {!companionStatus.checking && !companionStatus.running && (
        <div className={styles.offline}>
          <MonitorDown size={22} />
          <div>
            <strong>Open the AgenticThat Companion to make changes in the apps</strong>
            <span>Your contacts and groups are saved on AgenticThat. The Companion on this computer holds your WhatsApp, Telegram, Discord, Messenger and Instagram logins and makes the changes there. This page connects as soon as it&apos;s running.</span>
          </div>
          <Link className={styles.primary} href="/companion/download">Get the Companion</Link>
        </div>
      )}
      {companionStatus.running && !companionStatus.supported && (
        <div className={styles.offline}>
          <RefreshCw size={22} />
          <div>
            <strong>Update the Companion</strong>
            <span>The Companion running on this computer is from before Group Manager (it needs version 2.4.0 or newer). Install the latest version, then come back to this page.</span>
          </div>
          <Link className={styles.primary} href="/companion/download">Get the update</Link>
        </div>
      )}

      {loadError && <p className={styles.error} role="alert">{loadError}</p>}
      {notice && <p className={styles.notice} role="status"><CloudOff size={15} /> {notice}</p>}

      {data && (
        <>
          <section className={styles.connections} aria-label="Connected apps">
            {MESSAGING_APPS.map((app) => {
              const entry = connections.find((connection) => connection.app === app) || { state: online ? "disconnected" : "offline" };
              return (
                <button key={app} type="button" className={styles.connection} data-state={entry.state} style={{ "--app": APPS[app].color }} onClick={() => online && setConnecting(app)} disabled={!online}>
                  <AppLogo app={app} size={26} />
                  <span>
                    <strong>{APPS[app].label}</strong>
                    <small>{!online ? "Needs the Companion" : entry.state === "connected" ? entry.account || "Connected" : STATE_LABELS[entry.state] || "Not connected"}</small>
                  </span>
                  <em>{entry.state === "connected" ? "Manage" : "Connect"}</em>
                </button>
              );
            })}
          </section>

          <div className={styles.layout}>
            <div className={styles.groupsColumn}>
              <div className={styles.groupTabs} role="tablist" aria-label="Your groups">
                {groups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    role="tab"
                    aria-selected={!creating && selected?.id === group.id}
                    className={!creating && selected?.id === group.id ? styles.groupTabOn : ""}
                    onClick={() => { setCreating(false); setSelectedId(group.id); }}
                  >
                    <span>{group.name}</span>
                    <span className={styles.tabApps}>{MESSAGING_APPS.filter((app) => group.apps[app]).map((app) => <AppLogo key={app} app={app} size={13} />)}</span>
                  </button>
                ))}
                <button type="button" className={`${styles.newTab} ${creating || !groups.length ? styles.groupTabOn : ""}`} onClick={() => setCreating(true)} disabled={!anyConnected}>
                  <Plus size={15} /> New group
                </button>
              </div>

              {(creating || !groups.length) && !anyConnected ? (
                <div className={styles.emptyState}>
                  <UsersRound size={30} />
                  <h2>{online ? "Connect an app to start" : "Open the Companion to create groups"}</h2>
                  <p>{online ? "Connect WhatsApp, Telegram, Discord, Messenger or Instagram above. Then create a group, and it's made in the real app." : "You can add people to Contact Master now. Creating groups in the apps needs the Companion running on this computer."}</p>
                </div>
              ) : creating || !groups.length ? (
                <NewGroupForm
                  contacts={contacts}
                  connections={connections}
                  onCreate={actions.createGroup}
                  onCancel={groups.length ? () => setCreating(false) : undefined}
                  onCreated={async (group) => { await refresh(); setCreating(false); setSelectedId(group.id); }}
                />
              ) : selected ? (
                <GroupDetail key={selected.id} group={selected} contacts={contacts} actions={actions} onChanged={refresh} onDeleted={() => { setSelectedId(""); void refresh(); }} />
              ) : null}
            </div>

            <ContactMaster contacts={contacts} workspaceName={workspaceName} onChanged={loadData} />
          </div>
        </>
      )}

      {connecting && online && (
        <ConnectPanel
          app={connecting}
          connection={connections.find((entry) => entry.app === connecting)}
          onClose={() => setConnecting("")}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
