"use client";

import { useState } from "react";
import { AlertTriangle, Check, Info, Link2, Loader2, RotateCcw, Send, Trash2, UserMinus, UserPlus, X } from "lucide-react";
import AppLogo, { APPS, MESSAGING_APPS, SOCIAL_APPS } from "./AppLogo";
import { ContactPicker } from "./NewGroupForm";
import styles from "./group-manager.module.css";

const MEMBER_LABELS = {
  pending: "Adding…",
  added: "Added",
  invited: "Invite sent",
  "not-on-app": "Not on this app",
  "missing-id": "No ID saved",
  failed: "Failed",
  removed: "Removed",
};

const GROUP_LABELS = { creating: "Creating…", ready: "Live", failed: "Not created" };

function CopyLink({ link }) {
  const [copied, setCopied] = useState(false);
  if (!link) return null;
  return (
    <button
      type="button"
      className={styles.linkButton}
      onClick={() => navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); })}
      title={link}
    >
      {copied ? <Check size={14} /> : <Link2 size={14} />} {copied ? "Copied" : "Copy invite link"}
    </button>
  );
}

function AppGroupCard({ app, status, members, contactsById, onRemove, busy }) {
  const counts = members.reduce((total, member) => {
    const state = member.apps[app]?.state;
    if (state === "added") total.added += 1;
    if (state === "invited") total.invited += 1;
    return total;
  }, { added: 0, invited: 0 });
  return (
    <article className={styles.appCard} style={{ "--app": APPS[app].color }} data-state={status.state}>
      <header>
        <AppLogo app={app} size={24} />
        <div>
          <strong>{APPS[app].label}</strong>
          <span className={styles.groupState} data-state={status.state}>
            {status.state === "creating" && <Loader2 size={12} className={styles.spin} />}
            {GROUP_LABELS[status.state]}
            {status.state === "ready" && ` · ${counts.added} added${counts.invited ? `, ${counts.invited} invited` : ""}`}
          </span>
        </div>
      </header>
      {status.link && <div className={styles.appCardLink}><CopyLink link={status.link} /></div>}
      {status.state === "failed" && <p className={styles.error}>{status.error}</p>}
      <ul className={styles.memberList}>
        {members.map((member) => {
          const contact = contactsById.get(member.contactId);
          const result = member.apps[app];
          if (!result) return null;
          return (
            <li key={member.contactId} data-state={result.state}>
              <span className={styles.avatarSmall} aria-hidden="true">{(contact?.name || "?").charAt(0).toUpperCase()}</span>
              <div>
                <strong>{contact?.name || "Deleted contact"}</strong>
                {result.detail && <small>{result.detail}</small>}
              </div>
              <span className={styles.memberState} data-state={result.state}>
                {result.state === "pending" && <Loader2 size={11} className={styles.spin} />}
                {result.detail === "Removing…" ? "Removing…" : MEMBER_LABELS[result.state]}
              </span>
              {result.state === "invited" && <CopyLink link={result.link} />}
              <button type="button" className={styles.iconButton} disabled={busy || result.state === "pending"} onClick={() => onRemove(member.contactId, contact?.name)} aria-label={`Remove ${contact?.name || "member"}`}><UserMinus size={14} /></button>
            </li>
          );
        })}
        {!members.some((member) => member.apps[app]) && <li className={styles.faint}>No members yet.</li>}
      </ul>
    </article>
  );
}

export default function GroupDetail({ group, contacts, actions, onChanged, onDeleted }) {
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  const apps = MESSAGING_APPS.filter((app) => group.apps[app]);
  const readyApps = apps.filter((app) => group.apps[app].state === "ready");
  const needsRetry = apps.some((app) => group.apps[app].state === "failed")
    || group.members.some((member) => apps.some((app) => ["failed", "missing-id", "not-on-app"].includes(member.apps[app]?.state)));

  const run = async (name, action) => {
    setBusy(name);
    setError("");
    try {
      await action();
      await onChanged();
      return true;
    } catch (failure) {
      setError(failure.message);
      return false;
    } finally {
      setBusy("");
    }
  };

  const addPeople = async () => {
    if (await run("add", () => actions.addMembers(group, selected))) {
      setSelected([]);
      setAdding(false);
    }
  };

  const remove = (contactId, name) => {
    if (!window.confirm(`Remove ${name || "this person"} from "${group.name}" in ${apps.map((app) => APPS[app].label).join(" and ")}?`)) return;
    void run("remove", () => actions.removeMember(group, contactId));
  };

  const send = async (event) => {
    event.preventDefault();
    if (await run("send", () => actions.sendMessage(group, text))) setText("");
  };

  const forget = async () => {
    if (!window.confirm(`Remove "${group.name}" from Group Manager? The groups stay in ${apps.map((app) => APPS[app].label).join(" and ")}; you'll manage them in those apps.`)) return;
    if (await run("delete", () => actions.deleteGroup(group))) onDeleted();
  };

  return (
    <section className={styles.groupDetail} aria-labelledby="group-title">
      <header className={styles.groupHead}>
        <div>
          <p className={styles.eyebrowSmall}>Group name</p>
          <h2 id="group-title">{group.name}</h2>
          {group.description && <p className={styles.muted}>{group.description}</p>}
        </div>
        <div className={styles.groupActions}>
          {needsRetry && <button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={() => run("retry", () => actions.retry(group))}>{busy === "retry" ? <Loader2 size={15} className={styles.spin} /> : <RotateCcw size={15} />} Try again</button>}
          <button type="button" className={styles.primary} disabled={Boolean(busy) || !apps.length} onClick={() => setAdding((open) => !open)}><UserPlus size={15} /> Add people</button>
          <button type="button" className={styles.iconButton} disabled={Boolean(busy)} onClick={forget} aria-label="Remove group from Group Manager"><Trash2 size={16} /></button>
        </div>
      </header>

      {error && <p className={styles.error} role="alert"><AlertTriangle size={15} /> {error}</p>}

      {adding && (
        <div className={styles.addPeople}>
          <div className={styles.formHead}><strong>Add people to {group.name}</strong><button type="button" className={styles.iconButton} onClick={() => setAdding(false)} aria-label="Close"><X size={16} /></button></div>
          <ContactPicker contacts={contacts} selected={selected} onChange={setSelected} apps={apps} exclude={group.members.map((member) => member.contactId)} />
          <div className={styles.formActions}>
            <button type="button" className={styles.primary} disabled={!selected.length || busy === "add"} onClick={addPeople}>{busy === "add" && <Loader2 size={15} className={styles.spin} />} Add {selected.length || ""} to {apps.map((app) => APPS[app].label).join(" and ")}</button>
          </div>
        </div>
      )}

      <h3 className={styles.rowTitle}>Messaging</h3>
      <div className={styles.appCards}>
        {apps.map((app) => (
          <AppGroupCard key={app} app={app} status={group.apps[app]} members={group.members} contactsById={contactsById} onRemove={remove} busy={Boolean(busy)} />
        ))}
      </div>

      <form className={styles.composer} onSubmit={send}>
        <label htmlFor="group-message">Message the group</label>
        <textarea id="group-message" value={text} onChange={(event) => setText(event.target.value)} rows={3} maxLength={4000} placeholder={`Write to everyone in ${group.name}…`} />
        <div className={styles.composerFoot}>
          <span className={styles.composerApps}>{readyApps.map((app) => <AppLogo key={app} app={app} size={16} />)} Sends in {readyApps.length ? readyApps.map((app) => APPS[app].label).join(", ") : "no app yet"}</span>
          <button type="submit" className={styles.primary} disabled={!text.trim() || !readyApps.length || busy === "send"}>{busy === "send" ? <Loader2 size={15} className={styles.spin} /> : <Send size={15} />} Send</button>
        </div>
      </form>

      {group.messages.length > 0 && (
        <ol className={styles.history} aria-label="Sent messages">
          {[...group.messages].reverse().slice(0, 8).map((sent) => (
            <li key={sent.id}>
              <p>{sent.text}</p>
              <span>
                {new Date(sent.sentAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                {Object.entries(sent.results).map(([app, result]) => (
                  <span key={app} className={styles.sentState} data-state={result.state} title={result.error || ""}>
                    <AppLogo app={app} size={13} /> {result.state === "sending" ? "Sending…" : result.state === "sent" ? "Sent" : "Failed"}
                  </span>
                ))}
              </span>
              {Object.values(sent.results).some((result) => result.error) && <small className={styles.errorText}>{Object.entries(sent.results).filter(([, result]) => result.error).map(([app, result]) => `${APPS[app].label}: ${result.error}`).join(" · ")}</small>}
            </li>
          ))}
        </ol>
      )}

      <h3 className={styles.rowTitle}>Posting <span className={styles.soonTag}>Coming later</span></h3>
      <div className={styles.socialRow}>
        {SOCIAL_APPS.map((app) => (
          <div key={app} className={styles.socialCard}>
            <AppLogo app={app} size={20} />
            <span>{APPS[app].label}</span>
          </div>
        ))}
      </div>
      <p className={styles.faint}><Info size={12} /> Social IDs you save in Contact Master will be used when these arrive.</p>
    </section>
  );
}
