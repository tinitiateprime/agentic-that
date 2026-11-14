"use client";

import { useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Search, Trash2, UserRound, X } from "lucide-react";
import AppLogo from "./AppLogo";
import { website } from "./companion-groups";
import styles from "./group-manager.module.css";

export const CONTACT_FIELDS = [
  { key: "whatsapp", label: "WhatsApp number", placeholder: "+91 63091 23485", inputMode: "tel" },
  { key: "telegram", label: "Telegram number or @username", placeholder: "+91 63091 23485 or @name" },
  { key: "discord", label: "Discord user ID", placeholder: "17–20 digits (or username)", hint: "In Discord: Settings → Advanced → Developer Mode on, then right-click the person → Copy User ID." },
  { key: "instagram", label: "Instagram ID", placeholder: "@username" },
  { key: "facebook", label: "Facebook ID", placeholder: "profile name or link" },
  { key: "x", label: "X ID", placeholder: "@username" },
  { key: "reddit", label: "Reddit ID", placeholder: "u/username" },
  { key: "linkedin", label: "LinkedIn", placeholder: "profile link" },
];

const EMPTY = { name: "", ...Object.fromEntries(CONTACT_FIELDS.map((field) => [field.key, ""])), note: "" };

function ContactForm({ initial, onSaved, onCancel }) {
  const [form, setForm] = useState({ ...EMPTY, ...(initial || {}) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = { name: form.name, note: form.note, ...Object.fromEntries(CONTACT_FIELDS.map((field) => [field.key, form[field.key]])) };
      await (initial?.id ? website.updateContact(initial.id, body) : website.addContact(body));
      await onSaved();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.contactForm} onSubmit={save}>
      <div className={styles.formHead}>
        <strong>{initial?.id ? `Edit ${initial.name}` : "New contact"}</strong>
        <button type="button" className={styles.iconButton} onClick={onCancel} aria-label="Cancel"><X size={16} /></button>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <label className={styles.field}><span><UserRound size={15} /> Contact name</span><input value={form.name} onChange={set("name")} required maxLength={80} autoFocus /></label>
      <p className={styles.formSection}>Messaging</p>
      {CONTACT_FIELDS.slice(0, 3).map((field) => (
        <label key={field.key} className={styles.field}>
          <span><AppLogo app={field.key} size={16} /> {field.label}</span>
          <input value={form[field.key]} onChange={set(field.key)} placeholder={field.placeholder} inputMode={field.inputMode} />
          {field.hint && <small>{field.hint}</small>}
        </label>
      ))}
      <p className={styles.formSection}>Social media</p>
      <div className={styles.twoFields}>
        {CONTACT_FIELDS.slice(3).map((field) => (
          <label key={field.key} className={styles.field}>
            <span><AppLogo app={field.key} size={16} /> {field.label}</span>
            <input value={form[field.key]} onChange={set(field.key)} placeholder={field.placeholder} />
          </label>
        ))}
      </div>
      <label className={styles.field}><span>Note (optional)</span><input value={form.note} onChange={set("note")} maxLength={240} /></label>
      <div className={styles.formActions}>
        <button type="button" className={styles.secondary} onClick={onCancel}>Cancel</button>
        <button type="submit" className={styles.primary} disabled={busy || !form.name.trim()}>{busy && <Loader2 size={16} className={styles.spin} />} Save contact</button>
      </div>
    </form>
  );
}

/** Which apps a contact can be reached on. */
export function ContactApps({ contact, size = 15 }) {
  const apps = CONTACT_FIELDS.map((field) => field.key).filter((key) => contact[key]);
  if (!apps.length) return <span className={styles.faint}>No IDs yet</span>;
  return <span className={styles.contactApps}>{apps.map((app) => <AppLogo key={app} app={app} size={size} />)}</span>;
}

export default function ContactMaster({ contacts, workspaceName, onChanged, disabled }) {
  const [editing, setEditing] = useState(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return contacts;
    return contacts.filter((contact) => [contact.name, ...CONTACT_FIELDS.map((field) => contact[field.key])].some((value) => String(value || "").toLowerCase().includes(needle)));
  }, [contacts, query]);

  const remove = async (contact) => {
    if (!window.confirm(`Delete ${contact.name} from Contact Master? They stay in any group they're already in.`)) return;
    setError("");
    try {
      await website.deleteContact(contact.id);
      await onChanged();
    } catch (failure) {
      setError(failure.message);
    }
  };

  const saved = async () => {
    setEditing(null);
    await onChanged();
  };

  return (
    <aside className={styles.contactMaster} aria-labelledby="contact-master-title">
      <header className={styles.contactHead}>
        <div>
          <h2 id="contact-master-title">Contact Master</h2>
          {workspaceName && <span className={styles.handle}>@{workspaceName.replace(/\s+/g, "")}</span>}
        </div>
        <button type="button" className={styles.primarySmall} disabled={disabled} onClick={() => setEditing({})}><Plus size={15} /> Add contact</button>
      </header>
      <p className={styles.muted}>Each person once, with their number or ID in every app. Saved on AgenticThat for your whole workspace.</p>

      {editing && <ContactForm initial={editing.id ? editing : null} onSaved={saved} onCancel={() => setEditing(null)} />}
      {error && <p className={styles.error} role="alert">{error}</p>}

      {contacts.length > 6 && (
        <label className={styles.search}><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search contacts" aria-label="Search contacts" /></label>
      )}

      {!contacts.length && !editing && (
        <div className={styles.emptyContacts}>
          <UserRound size={26} />
          <strong>No contacts yet</strong>
          <span>Add the people you want in your groups: name, WhatsApp number, Telegram, Discord ID and more.</span>
        </div>
      )}

      <ul className={styles.contactList}>
        {shown.map((contact) => (
          <li key={contact.id}>
            <span className={styles.avatar} aria-hidden="true">{contact.name.charAt(0).toUpperCase()}</span>
            <div>
              <strong>{contact.name}</strong>
              <span>{contact.whatsapp || contact.telegram || contact.discord || contact.instagram || contact.note || ""}</span>
            </div>
            <ContactApps contact={contact} />
            <div className={styles.rowActions}>
              <button type="button" className={styles.iconButton} onClick={() => setEditing(contact)} aria-label={`Edit ${contact.name}`} disabled={disabled}><Pencil size={15} /></button>
              <button type="button" className={styles.iconButton} onClick={() => remove(contact)} aria-label={`Delete ${contact.name}`} disabled={disabled}><Trash2 size={15} /></button>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
