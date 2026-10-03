"use client";

import Link from "next/link";
import { ArrowLeft, CheckCircle2, CircleAlert, Loader2, Search, Send, Settings2, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import ProductShell from "./ProductShell";
import { getClientServiceToken } from "./client-service-token";
import { recipientFromGroupLine } from "../../services/messaging/telegram/console/src/recipient-utils.js";
import { buildDirectory, buildGroups, personServices } from "./messaging-directory";
import styles from "./omnichannel-composer.module.css";

// One message, many messaging channels. Connections are owned by the
// Connection Manager; this page only reads them and sends through the
// existing WhatsApp group-broadcast and Telegram post APIs.

const WHATSAPP_CONNECT_HREF = "/config-manager?service=messaging&platform=whatsapp";
const TELEGRAM_CONNECT_HREF = "/config-manager?service=messaging&platform=telegram";

async function jsonRequest(url, init = {}) {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(url, { cache: "no-store", credentials: "include", ...init, headers });
  const text = await response.text().catch(() => "");
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const error = new Error(payload.message || payload.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function telegramRequest(path, identityToken, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", "Bearer " + await getClientServiceToken("telegram", identityToken));
  return jsonRequest("/api/telegram" + path, { ...init, headers });
}

// Meta answers with a long developer message when the saved sender is wrong; say what to do instead.
function plainWhatsAppError(message) {
  const text = String(message || "");
  if (/Object with ID '\d+' does not exist|missing permissions/i.test(text)) {
    return "WhatsApp cannot send from the saved phone number. Its Phone Number ID or access token in Connections is wrong or no longer allowed. Open Connections and re-check them.";
  }
  return text;
}

function plainTemplateError(message) {
  const text = String(message || "");
  if (/isn't configured|not configured|WABA/i.test(text)) {
    return "Templates cannot load because the WhatsApp Business Account ID is missing in Connections. It is different from the Phone Number ID.";
  }
  if (/does not exist|missing permissions|permission|OAuth|access token|expired/i.test(text)) {
    return "Meta refused to share your templates. The WhatsApp Business Account ID may be wrong, or the access token has expired or lacks the whatsapp_business_management permission.";
  }
  return `Meta did not return your templates: ${text}`;
}

function lines(value) {
  return String(value || "").split(/[\n,]+/).map((line) => line.trim()).filter(Boolean);
}

function telegramTargets(groups, selectedGroupIds, people, extraRecipients) {
  const seen = new Set();
  const targets = [];
  const add = (raw, source, kind, firstName = "") => {
    const recipient = recipientFromGroupLine(raw);
    if (!recipient) return;
    const key = recipient.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ recipient, source, firstName, kind });
  };
  groups
    .filter((group) => selectedGroupIds.includes(group.id))
    .forEach((group) => lines(group.members).forEach((member) => add(member, group.name || "Group", "group")));
  people.forEach((person) => add(person.telegram.recipient, person.name, "contact", String(person.name).split(/\s+/)[0]));
  lines(extraRecipients).forEach((recipient) => add(recipient, "Manual", "manual"));
  return targets;
}

function templateParams(template) {
  const names = template?.placeholderNames?.length
    ? template.placeholderNames
    : Array.from({ length: template?.placeholders || 0 }, (_, index) => String(index + 1));
  return names.map((name) => ({ name, value: "{{name}}" }));
}

function ConnectionNotice({ status, platform, href, error }) {
  const copy = {
    unauthorized: `Your role does not include ${platform} messaging.`,
    "needs-login": `Sign in to the ${platform} workspace in Connection Manager to use this channel.`,
    setup: `${platform} is not connected yet.`,
    offline: error || `${platform} did not respond. Try again in a moment.`,
  }[status] || `${platform} is not ready.`;
  return (
    <div className={styles.notice}>
      <CircleAlert size={16} aria-hidden="true" />
      <span>{copy}</span>
      {status !== "unauthorized" && (
        <Link href={href}>Open Connection Manager</Link>
      )}
    </div>
  );
}

function ResultLine({ result }) {
  if (!result) return null;
  if (result.state === "sending") {
    return <p className={`${styles.result} ${styles.resultPending}`}><Loader2 size={15} className={styles.spin} aria-hidden="true" />Sending…</p>;
  }
  if (result.state === "error") {
    return (
      <p className={`${styles.result} ${styles.resultError}`}>
        <CircleAlert size={15} aria-hidden="true" />{result.message}
        {result.message.includes("Connections") && <Link href={WHATSAPP_CONNECT_HREF}>Open Connections</Link>}
      </p>
    );
  }
  const partial = result.sent < result.total;
  return (
    <p className={`${styles.result} ${partial ? styles.resultWarn : styles.resultOk}`}>
      {partial ? <CircleAlert size={15} aria-hidden="true" /> : <CheckCircle2 size={15} aria-hidden="true" />}
      Delivered to {result.sent} of {result.total} recipient{result.total === 1 ? "" : "s"}
      {result.failures?.length ? <small>{result.failures.slice(0, 3).join(" · ")}{result.failures.length > 3 ? ` · +${result.failures.length - 3} more` : ""}</small> : null}
    </p>
  );
}

export default function OmnichannelComposer({ user, canUseWhatsApp, telegramIdentityToken }) {
  const [message, setMessage] = useState("");

  const [whatsapp, setWhatsapp] = useState({ status: "checking", provider: "", groups: [], contacts: [], templates: [], templateError: "", error: "" });
  const [waEnabled, setWaEnabled] = useState(false);
  const [waMode, setWaMode] = useState("text");
  const [waTemplate, setWaTemplate] = useState("");

  const [telegram, setTelegram] = useState({ status: "checking", accounts: [], groups: [], contacts: [], error: "" });
  const [tgEnabled, setTgEnabled] = useState(false);
  const [tgAccountId, setTgAccountId] = useState("");
  const [tgExtra, setTgExtra] = useState("");

  const [groupIds, setGroupIds] = useState([]);
  const [personIds, setPersonIds] = useState([]);
  const [personQuery, setPersonQuery] = useState("");
  const [personFilter, setPersonFilter] = useState("all");

  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState({});

  const loadWhatsApp = useCallback(async () => {
    if (!canUseWhatsApp) {
      setWhatsapp((current) => ({ ...current, status: "unauthorized" }));
      return;
    }
    setWhatsapp((current) => ({ ...current, status: "checking", error: "" }));
    try {
      const status = (await jsonRequest("/api/apps/status")).whatsapp || {};
      if (!status.workspaceAuthenticated) {
        setWhatsapp((current) => ({ ...current, status: "needs-login" }));
        return;
      }
      if (!status.connected) {
        setWhatsapp((current) => ({ ...current, status: "setup" }));
        return;
      }
      const provider = status.provider === "wati" ? "wati" : "meta";
      const [groupData, contactData, templateData] = await Promise.all([
        jsonRequest("/api/groups"),
        jsonRequest("/api/contacts").catch(() => ({ contacts: [] })),
        jsonRequest(provider === "wati" ? "/api/wati/templates" : "/api/meta/templates").catch((error) => ({ templates: [], error: error.message })),
      ]);
      const groups = groupData.groups || [];
      setWhatsapp({ status: "ready", provider, groups, contacts: contactData.contacts || [], templates: templateData.templates || [], templateError: templateData.error || "", error: "" });
      setWaEnabled(true);
    } catch (error) {
      setWhatsapp((current) => ({
        ...current,
        status: error.status === 401 || error.status === 403 ? "needs-login" : "offline",
        error: error.message,
      }));
    }
  }, [canUseWhatsApp]);

  const loadTelegram = useCallback(async () => {
    if (!telegramIdentityToken) {
      setTelegram((current) => ({ ...current, status: "unauthorized" }));
      return;
    }
    setTelegram((current) => ({ ...current, status: "checking", error: "" }));
    try {
      const [accountData, workspace] = await Promise.all([
        telegramRequest("/telegram/accounts", telegramIdentityToken),
        telegramRequest("/workspace-data", telegramIdentityToken),
      ]);
      const accounts = accountData.accounts || [];
      if (!accounts.length) {
        setTelegram((current) => ({ ...current, status: "setup", accounts: [] }));
        return;
      }
      setTelegram({ status: "ready", accounts, groups: workspace.groups || [], contacts: workspace.contacts || [], error: "" });
      setTgAccountId((current) => current || accounts[0].id);
      setTgEnabled(true);
    } catch (error) {
      setTelegram((current) => ({
        ...current,
        status: error.status === 401 ? "needs-login" : "offline",
        error: error.message,
      }));
    }
  }, [telegramIdentityToken]);

  useEffect(() => {
    void loadWhatsApp();
    void loadTelegram();
  }, [loadWhatsApp, loadTelegram]);

  const waTemplateRecord = whatsapp.templates.find((template) => template.name === waTemplate);
  const waReady = whatsapp.status === "ready" && waEnabled;
  const tgReady = telegram.status === "ready" && tgEnabled;
  const trimmed = message.trim();

  const directory = useMemo(() => buildDirectory(whatsapp.contacts, telegram.contacts), [whatsapp.contacts, telegram.contacts]);
  const groups = useMemo(() => buildGroups(whatsapp.groups, telegram.groups), [whatsapp.groups, telegram.groups]);

  // What each ticked group / person can actually be sent on right now.
  const pickedGroups = groups.filter((group) => groupIds.includes(group.id));
  const pickedPeople = directory.filter((person) => personIds.includes(person.id));
  const waGroups = waReady ? pickedGroups.map((group) => group.whatsapp).filter((group) => group && Number(group.member_count)) : [];
  const waPeople = waReady ? pickedPeople.filter((person) => person.whatsapp) : [];
  const tgGroupIds = tgReady ? pickedGroups.map((group) => group.telegram?.id).filter(Boolean) : [];
  const tgPeople = tgReady ? pickedPeople.filter((person) => person.telegram) : [];
  const tgTargets = tgReady ? telegramTargets(telegram.groups, tgGroupIds, tgPeople, tgExtra) : [];
  const waInactive = waMode === "text" ? waPeople.filter((person) => !person.whatsapp.active) : [];
  const waCount = waGroups.reduce((sum, group) => sum + Number(group.member_count || 0), 0) + waPeople.length;

  const problems = [];
  if (!waReady && !tgReady) problems.push("Turn on WhatsApp or Telegram.");
  if (!trimmed && !(waMode === "template" && waReady && !tgReady)) problems.push("Write a message.");
  if (waReady && waMode === "template" && !waTemplate) problems.push("WhatsApp: choose an approved template.");
  if (tgReady && !tgAccountId) problems.push("Telegram: choose the sending account.");
  if ((waReady || tgReady) && waCount + tgTargets.length === 0) problems.push("Choose at least one group or person to send to.");
  const uniqueProblems = [...new Set(problems)];
  const channelCount = Number(waCount > 0) + Number(tgTargets.length > 0);
  const audienceCount = waCount + tgTargets.length;

  async function sendWhatsApp() {
    setResults((current) => ({ ...current, whatsapp: { state: "sending" } }));
    try {
      const content = waMode === "template"
        ? { watiTemplate: waTemplate, templateParams: templateParams(waTemplateRecord), language: waTemplateRecord?.language }
        : { body: trimmed };
      let sent = 0;
      let total = 0;
      const failures = [];
      const tally = (data) => {
        sent += data.sent || 0;
        total += data.total || 0;
        (data.results || []).filter((row) => row.status === "failed").forEach((row) => failures.push(`${row.name}: ${plainWhatsAppError(row.error) || "failed"}`));
      };
      for (const group of waGroups) {
        tally(await jsonRequest(`/api/groups/${encodeURIComponent(group.id)}/broadcast`, { method: "POST", body: JSON.stringify(content) }));
      }
      if (waPeople.length) {
        tally(await jsonRequest("/api/messages/send-selected", {
          method: "POST",
          body: JSON.stringify({ ...content, contactIds: waPeople.map((person) => person.whatsapp.id), excludeGroupIds: waGroups.map((group) => group.id) }),
        }));
      }
      setResults((current) => ({ ...current, whatsapp: { state: "done", sent, total, failures } }));
    } catch (error) {
      setResults((current) => ({ ...current, whatsapp: { state: "error", message: plainWhatsAppError(error.message) } }));
    }
  }

  async function sendTelegram() {
    setResults((current) => ({ ...current, telegram: { state: "sending" } }));
    try {
      const created = await telegramRequest("/posts", telegramIdentityToken, {
        method: "POST",
        body: JSON.stringify({
          accountId: tgAccountId,
          title: trimmed.split("\n")[0].slice(0, 80) || "Omnichannel message",
          type: "text",
          category: "Omnichannel",
          body: trimmed,
          groups: tgGroupIds,
          targets: tgTargets,
        }),
      });
      const sent = await telegramRequest(`/posts/${encodeURIComponent(created.post.id)}/send-now`, telegramIdentityToken, { method: "POST" });
      const deliveries = sent.post?.deliveries || [];
      const failures = deliveries.filter((row) => row.status === "Failed").map((row) => `${row.recipient}: ${row.error || "failed"}`);
      setResults((current) => ({
        ...current,
        telegram: { state: "done", sent: deliveries.filter((row) => row.status === "Sent").length, total: deliveries.length || tgTargets.length, failures },
      }));
    } catch (error) {
      setResults((current) => ({ ...current, telegram: { state: "error", message: error.message } }));
    }
  }

  async function sendAll() {
    setConfirming(false);
    setSending(true);
    setResults({});
    await Promise.all([waCount > 0 ? sendWhatsApp() : null, tgTargets.length > 0 ? sendTelegram() : null]);
    setSending(false);
  }

  const toggle = (setter) => (id) => setter((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const toggleGroup = toggle(setGroupIds);
  const togglePerson = toggle(setPersonIds);

  const query = personQuery.trim().toLowerCase();
  const visiblePeople = directory.filter((person) => (
    (personFilter === "all" || personServices(person) === personFilter)
    && (!query || [person.name, person.whatsapp?.phone, person.telegram?.recipient].join(" ").toLowerCase().includes(query))
  ));
  const filters = [
    { id: "all", label: "Everyone", count: directory.length },
    { id: "both", label: "WhatsApp + Telegram", count: directory.filter((person) => personServices(person) === "both").length },
    { id: "whatsapp", label: "WhatsApp only", count: directory.filter((person) => personServices(person) === "whatsapp").length },
    { id: "telegram", label: "Telegram only", count: directory.filter((person) => personServices(person) === "telegram").length },
  ];
  const directoryLoading = whatsapp.status === "checking" || telegram.status === "checking";

  const finished = !sending && Object.values(results).some((result) => result?.state === "done" || result?.state === "error");

  return (
    <ProductShell user={user} active="messaging">
      <main className={styles.page}>
        <header className={styles.header}>
          <Link href="/apps" className={styles.back}><ArrowLeft size={16} aria-hidden="true" />Back to Home</Link>
          <div className={styles.headerRow}>
            <div>
              <span className={styles.eyebrow}>Send messages</span>
              <h1>Write one message, send it to everyone</h1>
              <p>Type your message, tick where it should go (WhatsApp, Telegram or both), then press Send.</p>
            </div>
            <Link href="/config-manager?service=messaging" className={styles.manage}>
              <Settings2 size={16} aria-hidden="true" />Connect or change accounts
            </Link>
          </div>
        </header>

        <div className={styles.layout}>
          <section className={styles.composer} aria-label="Message">
            <label className={styles.fieldLabel} htmlFor="omni-message">Message</label>
            <textarea
              id="omni-message"
              className={styles.textarea}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Write the message your audience will receive…"
              rows={9}
              maxLength={4000}
            />
            <div className={styles.composerMeta}>
              <span>{message.length} / 4000</span>
              {waReady && waMode === "text" && <span>WhatsApp: free text reaches contacts who messaged you in the last 24 hours.</span>}
            </div>

            <div className={styles.preview}>
              <span className={styles.fieldLabel}>Preview</span>
              <div className={styles.bubble}>{trimmed || <em>Your message will appear here.</em>}</div>
            </div>


            <section className={styles.audience} aria-label="Who should get this message">
              <h2>Who should get it?</h2>
              <p className={styles.audienceHint}>Tick groups and people. Each person gets the message on the apps they use.</p>

              {directoryLoading && <p className={styles.muted}><Loader2 size={14} className={styles.spin} aria-hidden="true" />Loading your contacts…</p>}

              <h3 className={styles.subHead}>Groups</h3>
              {groups.length ? (
                <div className={styles.chips}>
                  {groups.map((group) => {
                    const on = groupIds.includes(group.id);
                    const waCountHere = Number(group.whatsapp?.member_count || 0);
                    const tgCountHere = lines(group.telegram?.members).length;
                    return (
                      <button type="button" className={on ? styles.chipOn : ""} aria-pressed={on} onClick={() => toggleGroup(group.id)} disabled={sending} key={group.id}>
                        <Users size={13} aria-hidden="true" />{group.name}
                        {group.whatsapp && <small className={styles.tagWa} title={`${waCountHere} on WhatsApp`}>WA {waCountHere}</small>}
                        {group.telegram && <small className={styles.tagTg} title={`${tgCountHere} on Telegram`}>TG {tgCountHere}</small>}
                      </button>
                    );
                  })}
                </div>
              ) : (
                !directoryLoading && <p className={styles.muted}>No groups yet. Create one in <Link href="/groups">WhatsApp</Link> or <Link href="/console">Telegram</Link>.</p>
              )}

              <h3 className={styles.subHead}>People <span>{personIds.length ? `${personIds.length} selected` : `${directory.length} contacts`}</span></h3>
              <div className={styles.personTools}>
                <label className={styles.personSearch}>
                  <Search size={15} aria-hidden="true" />
                  <input value={personQuery} onChange={(event) => setPersonQuery(event.target.value)} placeholder="Search by name, number or @username" aria-label="Search contacts" />
                </label>
                <div className={styles.filterRow} role="group" aria-label="Filter contacts">
                  {filters.map((filter) => (
                    <button type="button" className={personFilter === filter.id ? styles.chipOn : ""} aria-pressed={personFilter === filter.id} onClick={() => setPersonFilter(filter.id)} key={filter.id}>
                      {filter.label}<small>{filter.count}</small>
                    </button>
                  ))}
                </div>
              </div>

              {visiblePeople.length ? (
                <>
                  <div className={styles.bulkRow}>
                    <button type="button" onClick={() => setPersonIds((current) => [...new Set([...current, ...visiblePeople.map((person) => person.id)])])} disabled={sending}>Select all shown</button>
                    {personIds.length > 0 && <button type="button" onClick={() => setPersonIds([])} disabled={sending}>Clear</button>}
                  </div>
                  <ul className={styles.peopleList}>
                    {visiblePeople.map((person) => {
                      const on = personIds.includes(person.id);
                      const waOff = person.whatsapp && !waReady;
                      const tgOff = person.telegram && !tgReady;
                      return (
                        <li key={person.id}>
                          <label className={`${styles.person} ${on ? styles.personOn : ""}`}>
                            <input type="checkbox" checked={on} onChange={() => togglePerson(person.id)} disabled={sending} />
                            <span className={styles.personName}>
                              <strong>{person.name}</strong>
                              <small>{personServices(person) === "both" ? "On WhatsApp and Telegram" : personServices(person) === "whatsapp" ? "WhatsApp only" : "Telegram only"}</small>
                            </span>
                            <span className={styles.personChannels}>
                              {person.whatsapp && (
                                <span className={`${styles.tagWa} ${waOff ? styles.tagOff : ""}`} title={person.whatsapp.active ? "Messaged you in the last 24 hours" : "Needs an approved template to be reached"}>
                                  WhatsApp {person.whatsapp.phone}{person.whatsapp.active ? " · active" : ""}
                                </span>
                              )}
                              {person.telegram && (
                                <span className={`${styles.tagTg} ${tgOff ? styles.tagOff : ""}`}>Telegram {person.telegram.recipient}</span>
                              )}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : (
                !directoryLoading && <p className={styles.muted}>{directory.length ? "No one matches your search." : "No contacts yet. Add contacts in WhatsApp or Telegram and they will show up here."}</p>
              )}
              {waInactive.length > 0 && (
                <p className={styles.warnNote}><CircleAlert size={15} aria-hidden="true" />{waInactive.length} selected WhatsApp contact{waInactive.length === 1 ? " has" : "s have"} not messaged you in 24 hours, so a free-text message may not reach them. Switch to “Approved template” to reach everyone.</p>
              )}
            </section>
          </section>

          <aside className={styles.channels} aria-label="Channels">
            <h2>Channels</h2>

            <article className={`${styles.channel} ${waReady ? styles.channelOn : ""}`}>
              <label className={styles.channelHead}>
                <input
                  type="checkbox"
                  checked={waReady}
                  disabled={whatsapp.status !== "ready" || sending}
                  onChange={(event) => setWaEnabled(event.target.checked)}
                />
                <img src="/whatsapp-logo.svg" alt="" />
                <span>
                  <strong>WhatsApp</strong>
                  <small>{whatsapp.status === "ready" ? `Connected${whatsapp.provider === "wati" ? " via WATI" : ""}` : whatsapp.status === "checking" ? "Checking connection…" : "Not available"}</small>
                </span>
              </label>
              {whatsapp.status === "checking" && <p className={styles.muted}><Loader2 size={14} className={styles.spin} aria-hidden="true" />Loading WhatsApp…</p>}
              {!["checking", "ready"].includes(whatsapp.status) && (
                <ConnectionNotice status={whatsapp.status} platform="WhatsApp" href={WHATSAPP_CONNECT_HREF} error={whatsapp.error} />
              )}
              {waReady && (
                <div className={styles.channelBody}>
                  <div className={styles.segmented} role="radiogroup" aria-label="WhatsApp message type">
                    <button type="button" role="radio" aria-checked={waMode === "text"} className={waMode === "text" ? styles.segmentOn : ""} onClick={() => setWaMode("text")} disabled={sending}>Free text</button>
                    <button type="button" role="radio" aria-checked={waMode === "template"} className={waMode === "template" ? styles.segmentOn : ""} onClick={() => setWaMode("template")} disabled={sending}>Approved template</button>
                  </div>
                  {waMode === "template" && (
                    whatsapp.templates.length ? (
                      <>
                        <select aria-label="Approved WhatsApp template" value={waTemplate} onChange={(event) => setWaTemplate(event.target.value)} disabled={sending}>
                          <option value="">Choose a template…</option>
                          {whatsapp.templates.map((template) => (
                            <option value={template.name} key={`${template.name}-${template.language}`}>{template.name}{template.language ? ` (${template.language})` : ""}</option>
                          ))}
                        </select>
                        <p className={styles.hint}>Templates reach every contact. Placeholders are filled with each contact&apos;s name; the message above is not sent on WhatsApp.</p>
                      </>
                    ) : (
                      <div className={styles.notice}>
                        <CircleAlert size={16} aria-hidden="true" />
                        <span>{whatsapp.templateError ? plainTemplateError(whatsapp.templateError) : "No approved templates found. Create one in WhatsApp → Ready messages and wait for Meta to approve it."}</span>
                        <Link href={WHATSAPP_CONNECT_HREF}>Open Connections</Link>
                        <button type="button" onClick={() => void loadWhatsApp()}>Try again</button>
                      </div>
                    )
                  )}
                  <ResultLine result={results.whatsapp} />
                </div>
              )}
            </article>

            <article className={`${styles.channel} ${tgReady ? styles.channelOn : ""}`}>
              <label className={styles.channelHead}>
                <input
                  type="checkbox"
                  checked={tgReady}
                  disabled={telegram.status !== "ready" || sending}
                  onChange={(event) => setTgEnabled(event.target.checked)}
                />
                <img src="/telegram-logo.svg" alt="" />
                <span>
                  <strong>Telegram</strong>
                  <small>{telegram.status === "ready" ? `${telegram.accounts.length} account${telegram.accounts.length === 1 ? "" : "s"} connected` : telegram.status === "checking" ? "Checking connection…" : "Not available"}</small>
                </span>
              </label>
              {telegram.status === "checking" && <p className={styles.muted}><Loader2 size={14} className={styles.spin} aria-hidden="true" />Loading Telegram…</p>}
              {!["checking", "ready"].includes(telegram.status) && (
                <ConnectionNotice status={telegram.status} platform="Telegram" href={TELEGRAM_CONNECT_HREF} error={telegram.error} />
              )}
              {tgReady && (
                <div className={styles.channelBody}>
                  <label className={styles.fieldLabel} htmlFor="omni-tg-account">Send from</label>
                  <select id="omni-tg-account" value={tgAccountId} onChange={(event) => setTgAccountId(event.target.value)} disabled={sending}>
                    {telegram.accounts.map((account) => (
                      <option value={account.id} key={account.id}>{account.displayName || account.username || account.id}{account.username ? ` (@${account.username})` : ""}</option>
                    ))}
                  </select>
                  <label className={styles.fieldLabel} htmlFor="omni-tg-extra">Other channels or usernames</label>
                  <textarea
                    id="omni-tg-extra"
                    className={styles.smallTextarea}
                    value={tgExtra}
                    onChange={(event) => setTgExtra(event.target.value)}
                    placeholder="@yourchannel, @username or +15551234567 — one per line"
                    rows={3}
                    disabled={sending}
                  />
                  <p className={styles.hint}>The sending account must be allowed to post in any channel you add.</p>
                  <ResultLine result={results.telegram} />
                </div>
              )}
            </article>

            <div className={styles.sendBar}>
              {uniqueProblems.length > 0 && !sending ? (
                <ul className={styles.problems}>{uniqueProblems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
              ) : (
                <p className={styles.summary}>
                  {channelCount} channel{channelCount === 1 ? "" : "s"} · about {audienceCount} recipient{audienceCount === 1 ? "" : "s"}
                </p>
              )}
              <button
                type="button"
                className={styles.sendButton}
                disabled={uniqueProblems.length > 0 || sending}
                onClick={() => setConfirming(true)}
              >
                {sending ? <Loader2 size={17} className={styles.spin} aria-hidden="true" /> : <Send size={17} aria-hidden="true" />}
                {sending ? "Sending…" : "Review and send"}
              </button>
              {finished && (
                <button type="button" className={styles.resetButton} onClick={() => { setResults({}); setMessage(""); }}>Start a new message</button>
              )}
            </div>
          </aside>
        </div>

        {confirming && (
          <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="omni-confirm-title">
            <div className={styles.dialog}>
              <button type="button" className={styles.dialogClose} onClick={() => setConfirming(false)} aria-label="Cancel"><X size={18} /></button>
              <h2 id="omni-confirm-title">Send this message?</h2>
              <p>Messages are delivered immediately and cannot be recalled.</p>
              <ul className={styles.confirmList}>
                {waCount > 0 && (
                  <li><img src="/whatsapp-logo.svg" alt="" /><span><strong>WhatsApp</strong>{waCount} contact{waCount === 1 ? "" : "s"}{waGroups.length ? ` · ${waGroups.map((group) => group.name).join(", ")}` : ""}{waPeople.length ? ` · ${waPeople.length} selected` : ""}{waMode === "template" ? ` · template “${waTemplate}”` : ""}</span></li>
                )}
                {tgTargets.length > 0 && (
                  <li><img src="/telegram-logo.svg" alt="" /><span><strong>Telegram</strong>{tgTargets.length} recipient{tgTargets.length === 1 ? "" : "s"}</span></li>
                )}
              </ul>
              <div className={styles.dialogActions}>
                <button type="button" className={styles.resetButton} onClick={() => setConfirming(false)}>Cancel</button>
                <button type="button" className={styles.sendButton} onClick={sendAll}><Send size={16} aria-hidden="true" />Send now</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </ProductShell>
  );
}
