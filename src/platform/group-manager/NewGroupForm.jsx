"use client";

import { useMemo, useState } from "react";
import { Check, Loader2, Search, X } from "lucide-react";
import AppLogo, { APPS, MESSAGING_APPS, SOCIAL_APPS, contactIdentity } from "./AppLogo";
import { ContactApps } from "./ContactMaster";
import styles from "./group-manager.module.css";

/** Choose people from Contact Master. */
export function ContactPicker({ contacts, selected, onChange, apps = [], exclude = [] }) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return contacts.filter((contact) => !exclude.includes(contact.id) && (!needle || contact.name.toLowerCase().includes(needle)));
  }, [contacts, exclude, query]);
  const toggle = (id) => onChange(selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id]);
  if (!contacts.length) return <p className={styles.muted}>Add people in Contact Master first (on the right).</p>;
  return (
    <div className={styles.picker}>
      {contacts.length > 6 && <label className={styles.search}><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search contacts" aria-label="Search contacts" /></label>}
      <ul>
        {shown.map((contact) => {
          const missing = apps.filter((app) => !contactIdentity(contact, app));
          return (
            <li key={contact.id}>
              <label className={selected.includes(contact.id) ? styles.pickerOn : ""}>
                <input type="checkbox" checked={selected.includes(contact.id)} onChange={() => toggle(contact.id)} />
                <span className={styles.check} aria-hidden="true"><Check size={13} /></span>
                <strong>{contact.name}</strong>
                <ContactApps contact={contact} size={14} />
                {missing.length > 0 && <small>No {missing.map((app) => (app === "messenger" ? "Facebook profile" : APPS[app].label)).join(" or ")} saved</small>}
              </label>
            </li>
          );
        })}
        {!shown.length && <li className={styles.muted}>Nobody matches.</li>}
      </ul>
      {selected.length > 0 && <p className={styles.faint}>{selected.length} selected</p>}
    </div>
  );
}

export default function NewGroupForm({ contacts, connections, onCreate, onCreated, onCancel }) {
  const connected = (app) => connections.find((entry) => entry.app === app)?.state === "connected";
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [apps, setApps] = useState(() => MESSAGING_APPS.filter(connected).slice(0, 1));
  const [members, setMembers] = useState([]);
  const discord = connections.find((entry) => entry.app === "discord");
  const [guildId, setGuildId] = useState(discord?.guilds?.[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const toggleApp = (app) => setApps((current) => (current.includes(app) ? current.filter((entry) => entry !== app) : [...current, app]));

  const create = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const group = await onCreate({
        name,
        description,
        apps,
        contactIds: members,
        ...(apps.includes("discord") ? { discordGuildId: guildId } : {}),
      });
      await onCreated(group);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.newGroup} onSubmit={create}>
      <div className={styles.formHead}>
        <h2>New group</h2>
        {onCancel && <button type="button" className={styles.iconButton} onClick={onCancel} aria-label="Cancel"><X size={16} /></button>}
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}

      <label className={styles.field}><span>Group name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="For example: Tinitiate Batch 5" required maxLength={100} autoFocus /></label>
      <label className={styles.field}><span>Description (optional)</span><input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} placeholder="Shown in the group's info" /></label>

      <fieldset className={styles.appChoice}>
        <legend>Create it in</legend>
        <p className={styles.formSection}>Messaging</p>
        <div className={styles.appTiles}>
          {MESSAGING_APPS.map((app) => {
            const ready = connected(app);
            return (
              <label key={app} className={`${styles.appTile} ${apps.includes(app) ? styles.appTileOn : ""} ${ready ? "" : styles.appTileOff}`} style={{ "--app": APPS[app].color }}>
                <input type="checkbox" checked={apps.includes(app)} disabled={!ready} onChange={() => toggleApp(app)} />
                <AppLogo app={app} size={26} />
                <strong>{APPS[app].label}</strong>
                <small>{ready ? (app === "discord" ? "Private channel" : app === "messenger" || app === "instagram" ? "Group chat" : "Group") : "Connect it first"}</small>
              </label>
            );
          })}
        </div>
        <p className={styles.formSection}>Posting</p>
        <div className={styles.appTiles}>
          {SOCIAL_APPS.map((app) => (
            <span key={app} className={`${styles.appTile} ${styles.appTileSoon}`} title="Coming later">
              <AppLogo app={app} size={22} />
              <strong>{APPS[app].label}</strong>
              <small>Coming later</small>
            </span>
          ))}
        </div>
      </fieldset>

      {apps.includes("discord") && (
        <label className={styles.field}>
          <span><AppLogo app="discord" size={16} /> Discord server</span>
          <select value={guildId} onChange={(event) => setGuildId(event.target.value)} required>
            {!discord?.guilds?.length && <option value="">Add the bot to a server first</option>}
            {discord?.guilds?.map((guild) => <option key={guild.id} value={guild.id}>{guild.name}</option>)}
          </select>
        </label>
      )}

      <div className={styles.field}>
        <span>Members</span>
        <ContactPicker contacts={contacts} selected={members} onChange={setMembers} apps={apps} />
      </div>

      <div className={styles.formActions}>
        {onCancel && <button type="button" className={styles.secondary} onClick={onCancel}>Cancel</button>}
        <button type="submit" className={styles.primary} disabled={busy || !name.trim() || !apps.length || (apps.includes("discord") && !guildId)}>
          {busy && <Loader2 size={16} className={styles.spin} />} Create group{apps.length ? ` in ${apps.map((app) => APPS[app].label).join(", ")}` : ""}
        </button>
      </div>
    </form>
  );
}
