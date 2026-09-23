"use client";

import { GoogleGenAI } from "@google/genai";
import {
  AlertCircle,
  ArrowRight,
  Bot,
  CalendarCheck,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Headphones,
  Keyboard,
  Mail,
  MessageSquareText,
  Mic,
  Phone,
  PhoneCall,
  PhoneForwarded,
  Save,
  Send,
  Sparkles,
  UserRound,
  Volume2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const emptyLead = { callerName: "", callerPhone: "", reason: "", urgency: "normal" };

function formatDuration(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function formatTime(value) {
  try {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
  } catch {
    return "Just now";
  }
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function bytesToBase64(bytes) {
  let binary = "";
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + step, bytes.length)));
  }
  return window.btoa(binary);
}

function floatToPcmBase64(input) {
  const pcm = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return bytesToBase64(new Uint8Array(pcm.buffer));
}

function StatusPill({ state }) {
  const labels = {
    idle: "Ready for demo",
    preparing: "Connecting securely",
    live: "Live call",
    typed: "Typed demo",
    ending: "Preparing summary",
    completed: "Call completed",
    error: "Needs attention",
  };
  return <span className={`pfd-status pfd-status-${state}`}><i />{labels[state] || labels.idle}</span>;
}

function LoadingScreen() {
  return (
    <div className="pfd-loading">
      <span><PhoneCall size={24} /></span>
      <strong>Preparing your AI front desk</strong>
      <small>Loading the receptionist profile and recent calls…</small>
    </div>
  );
}

function Field({ label, hint, children, wide = false }) {
  return <label className={wide ? "pfd-field pfd-field-wide" : "pfd-field"}><span>{label}{hint && <small>{hint}</small>}</span>{children}</label>;
}

export default function PhoneFrontDeskWorkspace({ canOperate, canConfigure }) {
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [profile, setProfile] = useState(null);
  const [calls, setCalls] = useState([]);
  const [state, setState] = useState("idle");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [inputCaption, setInputCaption] = useState("");
  const [outputCaption, setOutputCaption] = useState("");
  const [lead, setLead] = useState(emptyLead);
  const [appointment, setAppointment] = useState(null);
  const [handoffRequested, setHandoffRequested] = useState(false);
  const [typedMessage, setTypedMessage] = useState("");
  const [typedSending, setTypedSending] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [latestCall, setLatestCall] = useState(null);

  const sessionRef = useRef(null);
  const mediaRef = useRef(null);
  const captureContextRef = useRef(null);
  const outputContextRef = useRef(null);
  const processorRef = useRef(null);
  const captureSourceRef = useRef(null);
  const outputSourcesRef = useRef(new Set());
  const transcriptViewportRef = useRef(null);
  const nextPlaybackAtRef = useRef(0);
  const transcriptRef = useRef([]);
  const inputBufferRef = useRef("");
  const outputBufferRef = useRef("");
  const startedAtRef = useRef(0);
  const endingRef = useRef(false);
  const stateRef = useRef("idle");

  const setCallState = useCallback((next) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const pushTranscript = useCallback((entries) => {
    const additions = (Array.isArray(entries) ? entries : [entries])
      .map((item) => ({ ...item, text: cleanText(item?.text), at: item?.at || new Date().toISOString() }))
      .filter((item) => item.text);
    if (!additions.length) return;
    transcriptRef.current = [...transcriptRef.current, ...additions].slice(-80);
    setTranscript(transcriptRef.current);
  }, []);

  const loadSnapshot = useCallback(async () => {
    try {
      const response = await fetch("/api/phone-front-desk", { cache: "no-store", credentials: "include" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to load AI Phone Front Desk.");
      setConfigured(Boolean(data.configured));
      setProfile(data.profile);
      setCalls(Array.isArray(data.calls) ? data.calls : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load AI Phone Front Desk.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadSnapshot(); }, [loadSnapshot]);

  useEffect(() => {
    if (!["live", "typed"].includes(state)) return undefined;
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [state]);

  useEffect(() => {
    const viewport = transcriptViewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [transcript, inputCaption, outputCaption, typedSending]);

  const stopPlayback = useCallback(() => {
    for (const source of outputSourcesRef.current) {
      try { source.stop(); } catch {}
    }
    outputSourcesRef.current.clear();
    nextPlaybackAtRef.current = outputContextRef.current?.currentTime || 0;
  }, []);

  const stopResources = useCallback(() => {
    endingRef.current = true;
    try { sessionRef.current?.sendRealtimeInput?.({ audioStreamEnd: true }); } catch {}
    try { sessionRef.current?.close?.(); } catch {}
    sessionRef.current = null;
    if (processorRef.current) {
      processorRef.current.onaudioprocess = null;
      try { processorRef.current.disconnect(); } catch {}
    }
    try { captureSourceRef.current?.disconnect(); } catch {}
    processorRef.current = null;
    captureSourceRef.current = null;
    mediaRef.current?.getTracks?.().forEach((track) => track.stop());
    mediaRef.current = null;
    stopPlayback();
    void captureContextRef.current?.close?.().catch(() => {});
    void outputContextRef.current?.close?.().catch(() => {});
    captureContextRef.current = null;
    outputContextRef.current = null;
  }, [stopPlayback]);

  const failLiveCall = useCallback((message) => {
    if (endingRef.current) return;
    stopResources();
    endingRef.current = false;
    setError(message || "The live voice connection was interrupted. Your typed demo is still available.");
    setCallState("error");
  }, [setCallState, stopResources]);

  useEffect(() => () => stopResources(), [stopResources]);

  const resetCall = useCallback(() => {
    stopResources();
    endingRef.current = false;
    transcriptRef.current = [];
    inputBufferRef.current = "";
    outputBufferRef.current = "";
    setTranscript([]);
    setInputCaption("");
    setOutputCaption("");
    setLead(emptyLead);
    setAppointment(null);
    setHandoffRequested(false);
    setLatestCall(null);
    setElapsed(0);
    setError("");
  }, [stopResources]);

  function updateProfile(field, value) {
    setProfile((current) => ({ ...current, [field]: value }));
    setDirty(true);
    setNotice("");
  }

  const saveProfile = useCallback(async ({ quiet = false } = {}) => {
    if (!canConfigure || !profile) return profile;
    setSaving(true);
    if (!quiet) setNotice("");
    try {
      const response = await fetch("/api/phone-front-desk", {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(profile),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to save the receptionist profile.");
      setProfile(data.profile);
      setDirty(false);
      if (!quiet) setNotice("Receptionist profile saved and ready for the next call.");
      return data.profile;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save the receptionist profile.");
      return null;
    } finally {
      setSaving(false);
    }
  }, [canConfigure, profile]);

  const scheduleAudio = useCallback((base64) => {
    const context = outputContextRef.current;
    if (!context || !base64) return;
    try {
      const binary = window.atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const sampleCount = Math.floor(bytes.byteLength / 2);
      const samples = new Float32Array(sampleCount);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let index = 0; index < sampleCount; index += 1) samples[index] = view.getInt16(index * 2, true) / 32768;
      const buffer = context.createBuffer(1, sampleCount, 24_000);
      buffer.copyToChannel(samples, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const startAt = Math.max(context.currentTime + 0.025, nextPlaybackAtRef.current);
      source.start(startAt);
      nextPlaybackAtRef.current = startAt + buffer.duration;
      outputSourcesRef.current.add(source);
      source.onended = () => outputSourcesRef.current.delete(source);
    } catch {
      setError("The call connected, but the browser could not play one audio response.");
    }
  }, []);

  const handleTools = useCallback((message) => {
    const callsToHandle = message?.toolCall?.functionCalls || [];
    if (!callsToHandle.length || !sessionRef.current) return;
    const functionResponses = callsToHandle.map((call) => {
      const args = call.args || {};
      if (call.name === "capture_lead") {
        setLead((current) => ({
          callerName: cleanText(args.caller_name) || current.callerName,
          callerPhone: cleanText(args.caller_phone) || current.callerPhone,
          reason: cleanText(args.reason) || current.reason,
          urgency: ["low", "normal", "high"].includes(args.urgency) ? args.urgency : current.urgency,
        }));
        return { id: call.id, name: call.name, response: { result: "Lead details saved for the demo summary." } };
      }
      if (call.name === "prepare_appointment") {
        setAppointment({
          service: cleanText(args.service),
          preferredDate: cleanText(args.preferred_date),
          preferredTime: cleanText(args.preferred_time),
          notes: cleanText(args.notes),
        });
        return { id: call.id, name: call.name, response: { result: "Appointment request prepared. It is not a confirmed calendar booking." } };
      }
      if (call.name === "request_human_handoff") {
        setHandoffRequested(true);
        if (args.reason) setLead((current) => ({ ...current, reason: current.reason || cleanText(args.reason), urgency: args.urgency || current.urgency }));
        return { id: call.id, name: call.name, response: { result: "Human callback requested. This browser demo cannot complete a live phone transfer." } };
      }
      return { id: call.id, name: call.name, response: { result: "Tool is not available in this demonstration." } };
    });
    try { sessionRef.current.sendToolResponse({ functionResponses }); } catch {}
  }, []);

  const handleLiveMessage = useCallback((message) => {
    handleTools(message);
    const server = message?.serverContent;
    if (!server) return;
    if (server.interrupted) stopPlayback();
    for (const part of server.modelTurn?.parts || []) {
      if (part.inlineData?.data && String(part.inlineData?.mimeType || "").startsWith("audio/")) scheduleAudio(part.inlineData.data);
    }
    if (server.inputTranscription?.text) {
      inputBufferRef.current += server.inputTranscription.text;
      setInputCaption(cleanText(inputBufferRef.current));
    }
    if (server.outputTranscription?.text) {
      outputBufferRef.current += server.outputTranscription.text;
      setOutputCaption(cleanText(outputBufferRef.current));
    }
    if (server.turnComplete) {
      const completed = [];
      if (cleanText(inputBufferRef.current)) completed.push({ role: "caller", text: inputBufferRef.current });
      if (cleanText(outputBufferRef.current)) completed.push({ role: "assistant", text: outputBufferRef.current });
      pushTranscript(completed);
      inputBufferRef.current = "";
      outputBufferRef.current = "";
      setInputCaption("");
      setOutputCaption("");
    }
  }, [handleTools, pushTranscript, scheduleAudio, stopPlayback]);

  const beginMicrophoneCapture = useCallback((stream) => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContextClass({ sampleRate: 16_000 });
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(1024, 1, 1);
    const silent = context.createGain();
    silent.gain.value = 0;
    processor.onaudioprocess = (event) => {
      if (!sessionRef.current || stateRef.current !== "live") return;
      try {
        sessionRef.current.sendRealtimeInput({
          audio: {
            data: floatToPcmBase64(event.inputBuffer.getChannelData(0)),
            mimeType: `audio/pcm;rate=${context.sampleRate}`,
          },
        });
      } catch {}
    };
    source.connect(processor);
    processor.connect(silent);
    silent.connect(context.destination);
    captureContextRef.current = context;
    captureSourceRef.current = source;
    processorRef.current = processor;
  }, []);

  const startVoiceCall = useCallback(async () => {
    if (!canOperate || stateRef.current === "preparing") return;
    resetCall();
    setCallState("preparing");
    setNotice("");
    try {
      if (dirty && canConfigure) {
        const saved = await saveProfile({ quiet: true });
        if (!saved) throw new Error("Save the receptionist profile before starting the call.");
      }
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser does not provide microphone access. Use the typed demo instead.");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      mediaRef.current = stream;
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("This browser cannot play live call audio. Use the typed demo instead.");
      outputContextRef.current = new AudioContextClass();
      await outputContextRef.current.resume();

      const response = await fetch("/api/phone-front-desk/session", { method: "POST", credentials: "include" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to create the live call session.");
      const ai = new GoogleGenAI({ apiKey: data.token, httpOptions: { apiVersion: "v1alpha" } });
      const session = await ai.live.connect({
        model: data.model,
        config: data.config,
        callbacks: {
          onopen: () => {},
          onmessage: handleLiveMessage,
          onerror: (event) => {
            failLiveCall(event?.message || "The live voice connection was interrupted. Your typed demo is still available.");
          },
          onclose: () => {
            if (!endingRef.current && stateRef.current === "live") {
              failLiveCall("The live voice session ended. You can continue with the typed demo.");
            }
          },
        },
      });
      sessionRef.current = session;
      endingRef.current = false;
      startedAtRef.current = Date.now();
      setCallState("live");
      beginMicrophoneCapture(stream);
      session.sendClientContent({
        turns: [{ role: "user", parts: [{ text: "Begin the demonstration call now. Say the approved greeting, then wait for the caller." }] }],
        turnComplete: true,
      });
    } catch (startError) {
      stopResources();
      endingRef.current = false;
      setError(startError instanceof Error ? startError.message : "Unable to start the live demo call.");
      setCallState("error");
    }
  }, [beginMicrophoneCapture, canConfigure, canOperate, dirty, failLiveCall, handleLiveMessage, resetCall, saveProfile, setCallState, stopResources]);

  const startTypedCall = useCallback(async () => {
    if (!canOperate || !profile || stateRef.current === "preparing") return;
    setCallState("preparing");
    setNotice("");
    try {
      let activeProfile = profile;
      if (dirty && canConfigure) {
        activeProfile = await saveProfile({ quiet: true });
        if (!activeProfile) throw new Error("Save the receptionist profile before starting the call.");
      }
      resetCall();
      startedAtRef.current = Date.now();
      const greeting = cleanText(activeProfile.greeting) || `Thank you for calling ${activeProfile.businessName}. How may I help you?`;
      pushTranscript({ role: "assistant", text: greeting });
      setCallState("typed");
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Unable to start the typed demo.");
      setCallState("error");
    }
  }, [canConfigure, canOperate, dirty, profile, pushTranscript, resetCall, saveProfile, setCallState]);

  const sendTypedMessage = useCallback(async () => {
    const message = cleanText(typedMessage);
    if (!message || typedSending || stateRef.current !== "typed") return;
    const previous = transcriptRef.current;
    setTypedMessage("");
    setTypedSending(true);
    pushTranscript({ role: "caller", text: message });
    try {
      const response = await fetch("/api/phone-front-desk/respond", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript: previous, message }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The receptionist could not respond.");
      pushTranscript({ role: "assistant", text: data.reply });
      if (data.lead) setLead((current) => ({ ...current, ...Object.fromEntries(Object.entries(data.lead).filter(([, value]) => value)) }));
      if (data.appointment) setAppointment(data.appointment);
      if (data.handoffRequested) setHandoffRequested(true);
      if (data.fallback) setNotice("The live model was busy, so the reliable scripted fallback answered this turn.");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "The receptionist could not respond.");
    } finally {
      setTypedSending(false);
    }
  }, [pushTranscript, typedMessage, typedSending]);

  const finishCall = useCallback(async () => {
    if (!["live", "typed", "error"].includes(stateRef.current)) return;
    const mode = stateRef.current === "typed" ? "typed" : "voice";
    if (cleanText(inputBufferRef.current)) pushTranscript({ role: "caller", text: inputBufferRef.current });
    if (cleanText(outputBufferRef.current)) pushTranscript({ role: "assistant", text: outputBufferRef.current });
    inputBufferRef.current = "";
    outputBufferRef.current = "";
    setInputCaption("");
    setOutputCaption("");
    const durationSeconds = Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000));
    setCallState("ending");
    stopResources();
    try {
      const response = await fetch("/api/phone-front-desk", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          transcript: transcriptRef.current,
          durationSeconds,
          lead,
          appointment,
          handoffRequested,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to prepare the call summary.");
      setLatestCall(data.call);
      setCalls((current) => [data.call, ...current.filter((item) => item.id !== data.call.id)].slice(0, 30));
      setNotice("Call complete. The lead and follow-up summary are saved below.");
      setCallState("completed");
    } catch (finishError) {
      setError(finishError instanceof Error ? finishError.message : "Unable to prepare the call summary.");
      setCallState("error");
    } finally {
      endingRef.current = false;
    }
  }, [appointment, handoffRequested, lead, pushTranscript, setCallState, stopResources]);

  const stats = useMemo(() => ({
    calls: calls.length,
    leads: calls.filter((call) => call.callerName || call.callerPhone).length,
    appointments: calls.filter((call) => call.appointment).length,
    handoffs: calls.filter((call) => call.handoffRequested).length,
  }), [calls]);

  if (loading) return <LoadingScreen />;
  if (!profile) return <div className="pfd-fatal"><AlertCircle size={25} /><strong>AI Phone Front Desk could not load</strong><p>{error || "Refresh the page and try again."}</p></div>;

  const callActive = ["preparing", "live", "typed", "ending"].includes(state);
  const currentSummary = latestCall || (state === "completed" ? calls[0] : null);

  return (
    <div className="pfd-page">
      <header className="pfd-hero">
        <div className="pfd-hero-copy">
          <span className="pfd-eyebrow"><Sparkles size={14} />AI receptionist demo studio</span>
          <h1>AI Phone Front Desk</h1>
          <p>Configure the essentials, start a natural browser call, and watch every enquiry become a clear lead and follow-up summary.</p>
          <div className="pfd-hero-meta">
            <StatusPill state={state} />
            <span><span className="pfd-engine-dot" />{configured ? "Gemini Live ready" : "Gemini setup needed"}</span>
            <span><Headphones size={15} />Headphones recommended</span>
          </div>
        </div>
        <div className="pfd-hero-mark" aria-hidden="true">
          <span><PhoneCall size={35} /></span>
          <i className="pfd-ring pfd-ring-one" />
          <i className="pfd-ring pfd-ring-two" />
        </div>
      </header>

      <section className="pfd-metrics" aria-label="Recent demo activity">
        <article><span><PhoneCall size={18} /></span><div><small>Demo calls</small><strong>{stats.calls}</strong></div></article>
        <article><span><UserRound size={18} /></span><div><small>Leads captured</small><strong>{stats.leads}</strong></div></article>
        <article><span><CalendarCheck size={18} /></span><div><small>Appointment requests</small><strong>{stats.appointments}</strong></div></article>
        <article><span><PhoneForwarded size={18} /></span><div><small>Human follow-ups</small><strong>{stats.handoffs}</strong></div></article>
      </section>

      {error && <div className="pfd-banner pfd-banner-error"><AlertCircle size={18} /><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="Dismiss error"><X size={16} /></button></div>}
      {notice && <div className="pfd-banner pfd-banner-success"><CheckCircle2 size={18} /><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Dismiss message"><X size={16} /></button></div>}

      <div className="pfd-workspace-grid">
        <section className="pfd-panel pfd-profile-panel">
          <header className="pfd-panel-header">
            <div><span>01 · Receptionist profile</span><h2>Teach it the business</h2></div>
            <span className="pfd-step-state"><Check size={14} />Essential setup</span>
          </header>
          <div className="pfd-form-grid">
            <Field label="Business name"><input value={profile.businessName} disabled={!canConfigure || callActive} onChange={(event) => updateProfile("businessName", event.target.value)} /></Field>
            <Field label="Business type"><input value={profile.businessType} disabled={!canConfigure || callActive} onChange={(event) => updateProfile("businessType", event.target.value)} placeholder="e.g. Plumbing company" /></Field>
            <Field label="Receptionist name"><input value={profile.assistantName} disabled={!canConfigure || callActive} onChange={(event) => updateProfile("assistantName", event.target.value)} /></Field>
            <Field label="Language"><input value={profile.language} disabled={!canConfigure || callActive} onChange={(event) => updateProfile("language", event.target.value)} placeholder="English" /></Field>
            <Field label="Services" hint="one per line" wide><textarea rows={4} value={(profile.services || []).join("\n")} disabled={!canConfigure || callActive} onChange={(event) => updateProfile("services", event.target.value.split("\n"))} /></Field>
            <Field label="Business hours" wide><textarea rows={2} value={profile.businessHours} disabled={!canConfigure || callActive} onChange={(event) => updateProfile("businessHours", event.target.value)} /></Field>
            <Field label="Opening greeting" wide><textarea rows={3} value={profile.greeting} disabled={!canConfigure || callActive} onChange={(event) => updateProfile("greeting", event.target.value)} /></Field>
            <Field label="Important FAQs and rules" hint="approved answers only" wide><textarea rows={5} value={profile.faqNotes} disabled={!canConfigure || callActive} onChange={(event) => updateProfile("faqNotes", event.target.value)} placeholder="Pricing rules, service areas, booking notes, what must go to a human…" /></Field>
            <Field label="Human callback number"><input value={profile.transferNumber} disabled={!canConfigure || callActive} onChange={(event) => updateProfile("transferNumber", event.target.value)} placeholder="Optional for demo" /></Field>
            <Field label="Follow-up email" hint="saved for live launch"><input type="email" value={profile.notificationEmail} disabled={!canConfigure || callActive} onChange={(event) => updateProfile("notificationEmail", event.target.value)} /></Field>
          </div>
          <footer className="pfd-profile-footer">
            <p><CheckCircle2 size={15} />The AI is instructed not to invent prices, policies or availability.</p>
            <button type="button" onClick={() => void saveProfile()} disabled={!canConfigure || saving || callActive || !dirty}><Save size={16} />{saving ? "Saving…" : dirty ? "Save profile" : "Profile saved"}</button>
          </footer>
        </section>

        <section className="pfd-panel pfd-call-panel">
          <header className="pfd-panel-header">
            <div><span>02 · Live experience</span><h2>Run the call</h2></div>
            {(state === "live" || state === "typed") && <strong className="pfd-timer"><Clock3 size={15} />{formatDuration(elapsed)}</strong>}
          </header>

          {state === "idle" || state === "error" ? (
            <div className="pfd-ready-stage">
              <div className="pfd-ready-visual"><span><Mic size={30} /></span><i /><i /><i /></div>
              <span className="pfd-kicker">Your receptionist is ready</span>
              <h3>Call {profile.businessName}</h3>
              <p>Use your microphone for the full natural voice experience. The typed mode follows the same business rules and remains ready as a fallback.</p>
              <div className="pfd-call-actions">
                <button className="pfd-primary-call" type="button" onClick={() => void startVoiceCall()} disabled={!canOperate || !configured}>
                  <Phone size={18} />Start voice demo<ArrowRight size={17} />
                </button>
                <button className="pfd-secondary-call" type="button" onClick={() => void startTypedCall()} disabled={!canOperate}>
                  <Keyboard size={18} />Use typed demo
                </button>
              </div>
              {!configured && <small className="pfd-stage-warning">Add GEMINI_API_KEY in Netlify to enable live voice. Typed fallback also requires Gemini for its best responses.</small>}
            </div>
          ) : state === "preparing" ? (
            <div className="pfd-connecting-stage"><div className="pfd-connecting-orbit"><PhoneCall size={27} /></div><strong>Opening the secure voice line</strong><p>Allow microphone access when your browser asks.</p></div>
          ) : state === "ending" ? (
            <div className="pfd-connecting-stage"><div className="pfd-connecting-orbit"><Sparkles size={27} /></div><strong>Preparing the follow-up</strong><p>Turning the conversation into a useful lead summary.</p></div>
          ) : state === "completed" ? (
            <div className="pfd-complete-stage">
              <span><CheckCircle2 size={32} /></span><small>Call complete</small><h3>{currentSummary?.callerName || "New caller"}</h3>
              <p>{currentSummary?.summary || "The demo call was captured successfully."}</p>
              <div><button className="pfd-primary-call" type="button" onClick={() => { resetCall(); setCallState("idle"); }}><PhoneCall size={17} />Start another call</button></div>
            </div>
          ) : (
            <div className="pfd-live-stage">
              <div className="pfd-call-topline">
                <span className="pfd-live-indicator"><i />{state === "live" ? "Microphone connected" : "Typed fallback active"}</span>
                <span>{state === "live" ? <><Volume2 size={15} />Gemini Live</> : <><Keyboard size={15} />Keyboard mode</>}</span>
              </div>
              <div className="pfd-wave" aria-hidden="true">{Array.from({ length: 28 }, (_, index) => <i style={{ "--bar": index }} key={index} />)}</div>
              <div className="pfd-transcript" aria-live="polite" ref={transcriptViewportRef}>
                {transcript.length === 0 && <p className="pfd-transcript-empty">The conversation will appear here as it happens.</p>}
                {transcript.map((item, index) => (
                  <article className={item.role === "assistant" ? "pfd-agent-line" : "pfd-caller-line"} key={`${item.at}-${index}`}>
                    <span>{item.role === "assistant" ? <Bot size={15} /> : <UserRound size={15} />}</span>
                    <div><small>{item.role === "assistant" ? profile.assistantName : "Caller"}</small><p>{item.text}</p></div>
                  </article>
                ))}
                {inputCaption && <article className="pfd-caller-line pfd-caption-live"><span><UserRound size={15} /></span><div><small>Caller · listening</small><p>{inputCaption}</p></div></article>}
                {outputCaption && <article className="pfd-agent-line pfd-caption-live"><span><Bot size={15} /></span><div><small>{profile.assistantName} · speaking</small><p>{outputCaption}</p></div></article>}
                {typedSending && <article className="pfd-agent-line pfd-caption-live"><span><Bot size={15} /></span><div><small>{profile.assistantName}</small><p className="pfd-thinking"><i /><i /><i /></p></div></article>}
              </div>
              {state === "typed" && (
                <form className="pfd-typed-composer" onSubmit={(event) => { event.preventDefault(); void sendTypedMessage(); }}>
                  <input value={typedMessage} onChange={(event) => setTypedMessage(event.target.value)} placeholder="Type what the caller says…" disabled={typedSending} autoFocus />
                  <button type="submit" disabled={!cleanText(typedMessage) || typedSending} aria-label="Send caller message"><Send size={17} /></button>
                </form>
              )}
              <button className="pfd-end-call" type="button" onClick={() => void finishCall()}><Phone size={17} />End call and create summary</button>
            </div>
          )}
        </section>

        <aside className="pfd-panel pfd-capture-panel">
          <header className="pfd-panel-header"><div><span>03 · Live capture</span><h2>Caller intelligence</h2></div></header>
          <div className="pfd-capture-stack">
            <article className={lead.callerName || lead.callerPhone ? "pfd-capture-card is-ready" : "pfd-capture-card"}>
              <span><UserRound size={18} /></span><div><small>Caller</small><strong>{lead.callerName || "Waiting for a name"}</strong><p>{lead.callerPhone || "Callback number will appear here"}</p></div>{(lead.callerName || lead.callerPhone) && <Check size={15} />}
            </article>
            <article className={lead.reason ? "pfd-capture-card is-ready" : "pfd-capture-card"}>
              <span><MessageSquareText size={18} /></span><div><small>Reason for calling</small><strong>{lead.reason || "Listening for the request"}</strong><p className={`pfd-urgency pfd-urgency-${lead.urgency}`}>{lead.urgency} priority</p></div>{lead.reason && <Check size={15} />}
            </article>
            <article className={appointment ? "pfd-capture-card is-ready" : "pfd-capture-card"}>
              <span><CalendarCheck size={18} /></span><div><small>Appointment</small><strong>{appointment?.service || "No request yet"}</strong><p>{appointment ? [appointment.preferredDate, appointment.preferredTime].filter(Boolean).join(" · ") || "Details captured" : "Date and time will appear here"}</p></div>{appointment && <Check size={15} />}
            </article>
            <article className={handoffRequested ? "pfd-capture-card is-ready" : "pfd-capture-card"}>
              <span><PhoneForwarded size={18} /></span><div><small>Human follow-up</small><strong>{handoffRequested ? "Callback requested" : "Not requested"}</strong><p>{profile.transferNumber ? `Team number: ${profile.transferNumber}` : "Add a team number in the profile"}</p></div>{handoffRequested && <Check size={15} />}
            </article>
          </div>
          <div className="pfd-demo-note"><Sparkles size={17} /><div><strong>Demo-safe by design</strong><p>Bookings and transfers are prepared for presentation but do not contact a real calendar or phone line yet.</p></div></div>
        </aside>
      </div>

      <section className="pfd-panel pfd-history-panel">
        <header className="pfd-panel-header">
          <div><span>Saved automatically</span><h2>Recent call outcomes</h2></div>
          <span className="pfd-history-count">{calls.length} saved</span>
        </header>
        {calls.length === 0 ? (
          <div className="pfd-empty-history"><PhoneCall size={24} /><strong>Your first call will appear here</strong><p>Complete either demo mode to create a transcript and follow-up summary.</p></div>
        ) : (
          <div className="pfd-history-list">
            {calls.slice(0, 8).map((call) => (
              <article key={call.id}>
                <span className="pfd-history-icon">{call.mode === "voice" ? <Mic size={18} /> : <Keyboard size={18} />}</span>
                <div className="pfd-history-person"><strong>{call.callerName || "Unknown caller"}</strong><small>{call.callerPhone || formatTime(call.createdAt)}</small></div>
                <div className="pfd-history-summary"><strong>{call.reason || "General enquiry"}</strong><p>{call.summary}</p></div>
                <div className="pfd-history-outcome"><span className={`pfd-urgency pfd-urgency-${call.urgency}`}>{call.urgency}</span><small>{formatDuration(call.durationSeconds)}</small></div>
                <ChevronRight size={18} />
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
