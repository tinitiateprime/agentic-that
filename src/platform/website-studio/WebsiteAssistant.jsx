"use client";

import { Conversation } from "@elevenlabs/client";
import {
  Bot,
  CheckCircle2,
  LoaderCircle,
  MessageCircle,
  Mic,
  Phone,
  PhoneCall,
  Send,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAYS_MS = [1_000, 2_500, 5_000];

export default function WebsiteAssistant({ source, businessName, phone = "" }) {
  const [panel, setPanel] = useState(null);
  const [status, setStatus] = useState("idle");
  const [activity, setActivity] = useState("");
  const [error, setError] = useState("");
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [leadCaptured, setLeadCaptured] = useState(false);
  const [appointmentCaptured, setAppointmentCaptured] = useState(false);
  const [assistantName, setAssistantName] = useState("Ava");

  const sessionRef = useRef(null);
  const runRef = useRef(0);
  const endingRef = useRef(false);
  const transcriptRef = useRef(null);
  const retryTimerRef = useRef(null);
  const pendingReconnectRef = useRef(null);
  const retryCountRef = useRef(0);
  const startRef = useRef(null);

  const pushMessage = useCallback((role, value) => {
    const text = cleanText(value);
    if (!text) return;
    setMessages((current) => {
      const latest = current.at(-1);
      if (latest?.role === role && latest?.text === text) return current;
      return [...current, { id: `${Date.now()}-${Math.random()}`, role, text }].slice(-60);
    });
  }, []);

  const endSession = useCallback(async () => {
    runRef.current += 1;
    endingRef.current = true;
    pendingReconnectRef.current = null;
    retryCountRef.current = 0;
    clearTimeout(retryTimerRef.current);
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) await session.endSession().catch(() => {});
    setActivity("");
    setSending(false);
    setStatus("idle");
    endingRef.current = false;
  }, []);

  useEffect(() => () => {
    runRef.current += 1;
    endingRef.current = true;
    pendingReconnectRef.current = null;
    clearTimeout(retryTimerRef.current);
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) void session.endSession().catch(() => {});
  }, []);

  useEffect(() => {
    if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [messages, activity]);

  const clientTools = useMemo(() => ({
    capture_lead: (details = {}) => {
      if (cleanText(details.caller_name) || cleanText(details.caller_phone) || cleanText(details.reason)) setLeadCaptured(true);
      return "The visitor's details are captured in this website conversation.";
    },
    prepare_appointment: (details = {}) => {
      if (cleanText(details.service) || cleanText(details.preferred_date) || cleanText(details.preferred_time)) setAppointmentCaptured(true);
      return "The appointment request is prepared but is not a confirmed booking.";
    },
    request_human_handoff: () => {
      setLeadCaptured(true);
      return "A human callback request is noted. Do not claim a live transfer occurred.";
    },
  }), []);

  const attemptPendingReconnect = useCallback(() => {
    retryTimerRef.current = null;
    const pending = pendingReconnectRef.current;
    if (!pending || endingRef.current || runRef.current !== pending.run) return;
    if (navigator.onLine === false || document.visibilityState === "hidden") {
      setActivity(navigator.onLine === false ? "Waiting for internet..." : "Waiting for this tab...");
      return;
    }
    pendingReconnectRef.current = null;
    void startRef.current?.(pending.mode, { reconnecting: true });
  }, []);

  const queueReconnect = useCallback((mode, run, details) => {
    if (endingRef.current || runRef.current !== run) return;
    sessionRef.current = null;
    setSending(false);

    if (details?.reason === "agent") {
      setActivity("");
      setStatus("ended");
      return;
    }

    if (retryCountRef.current >= MAX_RECONNECT_ATTEMPTS) {
      pendingReconnectRef.current = null;
      setActivity("");
      setError("The connection was interrupted. Select Try again to reconnect.");
      setStatus("error");
      return;
    }

    const attempt = retryCountRef.current + 1;
    retryCountRef.current = attempt;
    pendingReconnectRef.current = { mode, run };
    setError("");
    setStatus("reconnecting");
    setActivity(navigator.onLine === false ? "Waiting for internet..." : `Reconnecting... (${attempt}/${MAX_RECONNECT_ATTEMPTS})`);
    clearTimeout(retryTimerRef.current);
    retryTimerRef.current = setTimeout(attemptPendingReconnect, RECONNECT_DELAYS_MS[attempt - 1]);
  }, [attemptPendingReconnect]);

  useEffect(() => {
    const resumeReconnect = () => attemptPendingReconnect();
    const resumeVisibleReconnect = () => {
      if (document.visibilityState === "visible") attemptPendingReconnect();
    };
    window.addEventListener("online", resumeReconnect);
    document.addEventListener("visibilitychange", resumeVisibleReconnect);
    return () => {
      window.removeEventListener("online", resumeReconnect);
      document.removeEventListener("visibilitychange", resumeVisibleReconnect);
    };
  }, [attemptPendingReconnect]);

  const start = useCallback(async (mode, { reconnecting = false } = {}) => {
    const run = runRef.current + 1;
    runRef.current = run;
    endingRef.current = true;
    pendingReconnectRef.current = null;
    clearTimeout(retryTimerRef.current);
    const previous = sessionRef.current;
    sessionRef.current = null;
    if (previous) await previous.endSession().catch(() => {});
    endingRef.current = false;
    setPanel(mode);
    if (!reconnecting) {
      retryCountRef.current = 0;
      setMessages([]);
      setLeadCaptured(false);
      setAppointmentCaptured(false);
    }
    setError("");
    setActivity(reconnecting ? `Reconnecting... (${retryCountRef.current}/${MAX_RECONNECT_ATTEMPTS})` : "");
    setStatus(reconnecting ? "reconnecting" : "connecting");

    try {
      if (mode === "voice" && !reconnecting) {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Voice conversations are not supported by this browser.");
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        stream.getTracks().forEach((track) => track.stop());
      }
      const response = await fetch("/api/site-assistant/session", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(source),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The AI assistant could not connect.");
      if (runRef.current !== run) return;
      setAssistantName(cleanText(data.assistant?.name) || "Ava");

      const callbacks = {
        dynamicVariables: data.dynamicVariables,
        clientTools,
        onMessage: ({ message, role, source: messageSource }) => {
          const mappedRole = role === "agent" || messageSource === "ai" ? "assistant" : "visitor";
          pushMessage(mappedRole, message);
          if (mappedRole === "assistant") setSending(false);
        },
        onModeChange: ({ mode: activeMode }) => {
          setActivity(activeMode === "listening" ? "Listening…" : activeMode === "speaking" ? "Speaking…" : "");
        },
        onError: (message) => {
          setError(cleanText(message) || "The AI conversation was interrupted.");
          setSending(false);
          setStatus("error");
        },
        onDisconnect: (details) => {
          if (!endingRef.current && runRef.current === run) {
            queueReconnect(mode, run, details);
          }
        },
      };
      const session = mode === "voice"
        ? await Conversation.startSession({
          conversationToken: data.conversationToken,
          connectionType: "webrtc",
          ...callbacks,
        })
        : await Conversation.startSession({
          signedUrl: data.signedUrl,
          connectionType: "websocket",
          textOnly: true,
          ...callbacks,
        });
      if (runRef.current !== run) {
        await session.endSession().catch(() => {});
        return;
      }
      sessionRef.current = session;
      setError("");
      setActivity("");
      setStatus("live");
    } catch (startError) {
      if (runRef.current !== run) return;
      const message = startError instanceof Error ? startError.message : "The AI assistant could not connect.";
      if (reconnecting) {
        queueReconnect(mode, run, { reason: "error", message });
      } else {
        setError(message);
        setStatus("error");
      }
    }
  }, [clientTools, pushMessage, queueReconnect, source]);

  startRef.current = start;

  const close = useCallback(() => {
    void endSession();
    setPanel(null);
    setError("");
  }, [endSession]);

  const sendMessage = useCallback((event) => {
    event.preventDefault();
    const message = cleanText(draft);
    if (!message || sending || status !== "live" || !sessionRef.current) return;
    setDraft("");
    setSending(true);
    pushMessage("visitor", message);
    try {
      sessionRef.current.sendUserMessage(message);
    } catch {
      setSending(false);
      setError("Your message could not be sent. Please reconnect and try again.");
    }
  }, [draft, pushMessage, sending, status]);

  const reconnect = () => void start(panel || "chat");
  const isConnecting = status === "connecting" || status === "reconnecting";
  const displayPhone = cleanText(phone);

  return (
    <div className={`waas-assistant${panel ? " is-open" : ""}`} data-voice-agent-ready="true">
      {panel && (
        <section className="waas-assistant-panel" role="dialog" aria-label={`${businessName} AI assistant`}>
          <header>
            <span className="waas-assistant-avatar"><Sparkles size={18} /></span>
            <div><small>AI assistant</small><strong>{assistantName} at {businessName}</strong></div>
            <button type="button" onClick={close} aria-label="Close AI assistant"><X size={19} /></button>
          </header>

          {panel === "chat" ? (
            <>
              <div className="waas-assistant-messages" ref={transcriptRef} aria-live="polite">
                {isConnecting && <div className="waas-assistant-connecting"><LoaderCircle className="waas-spin" size={20} /><span>{status === "reconnecting" ? activity : "Connecting securely…"}</span></div>}
                {messages.map((message) => <p className={message.role} key={message.id}><span>{message.text}</span></p>)}
                {sending && <p className="assistant pending"><span><i /><i /><i /></span></p>}
                {error && <div className="waas-assistant-error">{error}</div>}
              </div>
              {(leadCaptured || appointmentCaptured) && <div className="waas-assistant-captured"><CheckCircle2 size={15} />{appointmentCaptured ? "Appointment request captured" : "Contact details captured"}</div>}
              <form className="waas-assistant-compose" onSubmit={sendMessage}>
                <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask about services, hours or appointments…" disabled={status !== "live"} aria-label="Message the AI assistant" />
                <button type="submit" disabled={!draft.trim() || sending || status !== "live"} aria-label="Send message"><Send size={18} /></button>
              </form>
            </>
          ) : (
            <div className="waas-assistant-voice">
              <div className={`waas-assistant-orb status-${status}`}><span><Mic size={31} /></span><i /><i /></div>
              <small>{status === "connecting" ? "Connecting securely…" : activity || (status === "live" ? "You can speak now" : "Conversation ended")}</small>
              <strong>{status === "live" ? `${assistantName} is ready to help` : status === "reconnecting" ? "Restoring your connection" : error || `Talk with ${businessName}`}</strong>
              {status === "live" && <p>Ask about services, opening hours or request an appointment.</p>}
              {(leadCaptured || appointmentCaptured) && <div className="waas-assistant-captured"><CheckCircle2 size={15} />Details captured</div>}
              {status === "live" ? <button className="waas-assistant-end" type="button" onClick={() => void endSession()}><X size={16} /> End conversation</button> : !isConnecting && <button className="waas-assistant-reconnect" type="button" onClick={reconnect}>Try again</button>}
            </div>
          )}

          <footer>
            <span><Bot size={13} /> AI-powered assistance</span>
            {displayPhone && <a href={`tel:${displayPhone.replace(/[^+\d]/g, "")}`}><Phone size={13} /> Call business</a>}
          </footer>
        </section>
      )}

      <div className="waas-assistant-actions">
        <button type="button" className="chat" onClick={() => panel === "chat" ? close() : void start("chat")} aria-label={`Chat with ${businessName}`}><MessageCircle size={20} /><strong>Chat</strong></button>
        <button type="button" className="voice" onClick={() => panel === "voice" ? close() : void start("voice")} aria-label={`Talk to ${businessName} AI`}><span>{isConnecting && panel === "voice" ? <LoaderCircle className="waas-spin" size={20} /> : panel === "voice" && status === "live" ? <Volume2 size={20} /> : <PhoneCall size={20} />}</span><strong>Talk to AI</strong></button>
      </div>
    </div>
  );
}
