"use client";

import { BookUser, Loader2, UsersRound } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import ContactMaster from "./ContactMaster";
import { website } from "./companion-groups";
import styles from "./group-manager.module.css";

// The Contacts page: the same Contact Master as in Groups, on its own. Saved
// on AgenticThat, so it works without the Companion running.
export default function ContactsWorkspace({ workspaceName = "" }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await website.state();
      setData({ contacts: Array.isArray(next.contacts) ? next.contacts : [], groups: Array.isArray(next.groups) ? next.groups : [] });
      setError("");
    } catch (failure) {
      setError(failure.message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <div>
          <span className={styles.eyebrow}><BookUser size={14} /> Contacts</span>
          <h1>Everyone you work with</h1>
          <p>Save each person once, with their WhatsApp number, Telegram, Discord, Messenger, Instagram and X. The same contacts appear in Groups, ready to add to any group.</p>
        </div>
        <Link href="/group-manager" className={styles.secondary}><UsersRound size={16} /> Go to Groups</Link>
      </header>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {!data && !error && <p className={styles.muted}><Loader2 size={16} className={styles.spin} /> Loading your contacts…</p>}
      {data && (
        <div className={styles.contactsPage}>
          <ContactMaster contacts={data.contacts} groups={data.groups} workspaceName={workspaceName} onChanged={load} standalone />
        </div>
      )}
    </div>
  );
}
