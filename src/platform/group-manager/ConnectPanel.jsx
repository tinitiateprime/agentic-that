"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Loader2, LogOut, QrCode, RefreshCw, X } from "lucide-react";
import AppLogo, { APPS } from "./AppLogo";
import { companion } from "./companion-groups";
import styles from "./group-manager.module.css";

/** Connecting one app: WhatsApp by QR code, Telegram by phone and code, Discord by bot token. */
export default function ConnectPanel({ app, connection, onClose, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const state = connection?.state || "disconnected";
  const label = APPS[app].label;
  const waitingForServer = app === "discord" && state === "connected" && !connection?.guilds?.length;

  // Discord: notice by itself when the bot has been added to a server.
  useEffect(() => {
    if (!waitingForServer) return undefined;
    const timer = setInterval(() => {
      void companion.refreshDiscord().then(onChanged).catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [waitingForServer, onChanged]);

  const run = async (action) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await onChanged();
    } catch (failure) {
      setError(failure.needsApp ? "Telegram can't be connected right now. Please try again later or contact AgenticThat support." : failure.message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () => {
    if (!window.confirm(`Disconnect ${label} from this computer? Your groups stay in ${label}.`)) return;
    void run(() => companion.disconnect(app));
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="connect-title" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section className={styles.dialog}>
        <header className={styles.dialogHead}>
          <AppLogo app={app} size={30} />
          <div>
            <h2 id="connect-title">{state === "connected" ? `${label} is connected` : `Connect ${label}`}</h2>
            <span>{state === "connected" ? connection.account : "Once, on this computer. It stays connected."}</span>
          </div>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>

        {error && <p className={styles.error} role="alert">{error}</p>}

        {app === "whatsapp" && state !== "connected" && (
          <div className={styles.dialogBody}>
            {state === "qr" && connection.qr ? (
              <div className={styles.qrBox}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={connection.qr} alt="WhatsApp QR code to scan" width={260} height={260} />
                <ol className={styles.steps}>
                  <li>Open <strong>WhatsApp</strong> on your phone.</li>
                  <li>Go to <strong>Settings → Linked devices → Link a device</strong>.</li>
                  <li>Point your phone at this code.</li>
                </ol>
              </div>
            ) : state === "connecting" ? (
              <p className={styles.muted}><Loader2 size={15} className={styles.spin} /> Connecting to WhatsApp…</p>
            ) : (
              <>
                <p className={styles.muted}>This links AgenticThat to your WhatsApp like WhatsApp Web does: scan a QR code once with your phone. It runs in the background with no browser window.</p>
                {connection?.detail && <p className={styles.notice}>{connection.detail}</p>}
                <p className={styles.notice}>WhatsApp limits numbers that add many people quickly, so Group Manager adds one person every few seconds.</p>
                <button type="button" className={styles.primary} disabled={busy} onClick={() => run(() => companion.linkWhatsApp())}>
                  {busy ? <Loader2 size={16} className={styles.spin} /> : <QrCode size={16} />} Link WhatsApp
                </button>
              </>
            )}
          </div>
        )}

        {app === "telegram" && state !== "connected" && (
          <div className={styles.dialogBody}>
            {state === "code" ? (
              <form onSubmit={(event) => { event.preventDefault(); void run(() => companion.telegramCode(code)); }}>
                <p className={styles.muted}>{connection.detail || "Telegram sent you a login code."}</p>
                <label className={styles.field}>Login code<input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" autoFocus required /></label>
                <button type="submit" className={styles.primary} disabled={busy || !code.trim()}>{busy && <Loader2 size={16} className={styles.spin} />} Continue</button>
              </form>
            ) : state === "password" ? (
              <form onSubmit={(event) => { event.preventDefault(); void run(() => companion.telegramPassword(password)); }}>
                <p className={styles.muted}>{connection.detail}</p>
                <label className={styles.field}>Two-step verification password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" autoFocus required /></label>
                <button type="submit" className={styles.primary} disabled={busy || !password}>{busy && <Loader2 size={16} className={styles.spin} />} Log in</button>
              </form>
            ) : (
              <form onSubmit={(event) => {
                event.preventDefault();
                void run(() => companion.startTelegram(phone));
              }}>
                <p className={styles.muted}>Log in with your own Telegram account, through Telegram&apos;s official API. Telegram sends a code to your Telegram app.</p>
                <label className={styles.field}>Your Telegram phone number<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+91 63091 23485" inputMode="tel" autoComplete="tel" required /></label>
                <button type="submit" className={styles.primary} disabled={busy || phone.replace(/\D/g, "").length < 8}>{busy && <Loader2 size={16} className={styles.spin} />} Send me the code</button>
              </form>
            )}
          </div>
        )}

        {app === "discord" && state !== "connected" && (
          <form className={styles.dialogBody} onSubmit={(event) => { event.preventDefault(); void run(() => companion.connectDiscord(token)); }}>
            <p className={styles.muted}>Discord groups are run by your own bot, through Discord&apos;s official API. It takes two minutes, once:</p>
            <ol className={styles.steps}>
              <li>Open the <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">Discord Developer Portal <ExternalLink size={12} /></a> and click <strong>New Application</strong> (name it, for example, your business name).</li>
              <li>Open <strong>Bot</strong>, click <strong>Reset Token</strong> and copy the token.</li>
              <li>Paste it here. Next, you&apos;ll add the bot to your server.</li>
            </ol>
            <label className={styles.field}>Bot token<input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" required /></label>
            <button type="submit" className={styles.primary} disabled={busy || token.trim().length < 30}>{busy && <Loader2 size={16} className={styles.spin} />} Connect Discord</button>
          </form>
        )}

        {state === "connected" && (
          <div className={styles.dialogBody}>
            {app === "discord" && waitingForServer && (
              <>
                <p className={styles.notice}>Last step: add your bot to a Discord server. Your groups will be private channels in it.</p>
                <ol className={styles.steps}>
                  <li>No server yet? In Discord, click <strong>+</strong> (Add a Server) at the bottom of the server list → <strong>Create My Own</strong> → <strong>For me and my friends</strong>.</li>
                  <li>Click the button below, choose your server and click <strong>Authorize</strong>. (Discord only lists servers you own or manage.)</li>
                </ol>
                <a className={styles.primary} href={connection.addBotUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Add the bot to your server</a>
                <p className={styles.muted}><Loader2 size={14} className={styles.spin} /> Waiting for the bot to join… this page notices by itself.</p>
              </>
            )}
            {app === "discord" && !waitingForServer && (
              <>
                <p className={styles.muted}>Groups are private channels in your server: people already in the server are added to the channel; anyone else gets an invite link.</p>
                <div className={styles.serverList}>
                  <strong>Servers the bot is in</strong>
                  {connection.guilds.map((guild) => <span key={guild.id}>{guild.name}</span>)}
                  <a className={styles.linkButton} href={connection.addBotUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Add it to another server</a>
                  <button type="button" className={styles.linkButton} disabled={busy} onClick={() => run(() => companion.refreshDiscord())}><RefreshCw size={14} /> Check again</button>
                </div>
              </>
            )}
            {app !== "discord" && <p className={styles.muted}>Groups you create here are made in your {label}, and members see them like any group.</p>}
            <button type="button" className={styles.dangerLink} disabled={busy} onClick={disconnect}><LogOut size={15} /> Disconnect {label}</button>
          </div>
        )}
      </section>
    </div>
  );
}
