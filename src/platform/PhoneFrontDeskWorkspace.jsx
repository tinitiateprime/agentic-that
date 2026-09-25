"use client";

import { Conversation } from "@elevenlabs/client";
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
  const [integrationsEnabled, setIntegrationsEnabled] = useState(false);
  const [notifications, setNotifications] = useState({ configured: false });
  const [calendar, setCalendar] = useState({ configured: false, connected: false });
  const [calendarOptions, setCalendarOptions] = useState([]);
  const [bookingTimeZone, setBookingTimeZone] = useState("");
  const [timeZoneOptions, setTimeZoneOptions] = useState([]);
  const [calendarVerified, setCalendarVerified] = useState(false);
  const [connectionBusy, setConnectionBusy] = useState("");
  const [verifyingCalendar, setVerifyingCalendar] = useState(false);
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
  const conversationIdRef = useRef("");
  const transcriptViewportRef = useRef(null);
  const transcriptRef = useRef([]);
  const startedAtRef = useRef(0);
  const callModeRef = useRef("voice");
  const endingRef = useRef(false);
  const autoFinalizeAttemptedRef = useRef(false);
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
      setIntegrationsEnabled(Boolean(data.integrationsEnabled));
      setNotifications(data.notifications || { configured: false });
      setCalendar(data.calendar || { configured: false, connected: false });
      setProfile(data.profile);
      setCalls(Array.isArray(data.calls) ? data.calls : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load AI Phone Front Desk.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadSnapshot(); }, [loadSnapshot]);

  useEffect(() => { setBookingTimeZone(calendar.timeZone || ""); }, [calendar.timeZone]);

  useEffect(() => {
    const supported = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    setTimeZoneOptions([...new Set(["Asia/Kolkata", "UTC", ...supported])].sort());
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("google");
    if (!result) return;
    url.searchParams.delete("google");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    if (result === "calendar-connected") setNotice("Google Calendar connected. Choose a calendar and verify access.");
    else if (result === "mail-connected") setNotice("Business Gmail connected. Send a test email before using it with customers.");
    else setError(result === "denied" ? "Google access was not approved." : result === "expired" ? "Google connection expired. Please try again." : "Google connection failed. Check the Google OAuth setup and try again.");
  }, []);

  useEffect(() => {
    if (!integrationsEnabled || !calendar.connected) { setCalendarOptions([]); return; }
    let active = true;
    fetch("/api/phone-front-desk/google/connections?calendars=true", { cache: "no-store", credentials: "include" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Could not list calendars.");
        if (active) setCalendarOptions(Array.isArray(data.calendars) ? data.calendars : []);
      })
      .catch((listError) => { if (active) setError(listError instanceof Error ? listError.message : "Could not list calendars."); });
    return () => { active = false; };
  }, [integrationsEnabled, calendar.connected]);

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

  const stopResources = useCallback(() => {
    endingRef.current = true;
    const activeSession = sessionRef.current;
    sessionRef.current = null;
    if (activeSession) void activeSession.endSession().catch(() => {});
  }, []);

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
    autoFinalizeAttemptedRef.current = false;
    transcriptRef.current = [];
    conversationIdRef.current = "";
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

  const verifyCalendar = useCallback(async () => {
    if (!canConfigure) return;
    setVerifyingCalendar(true);
    setError("");
    try {
      if (dirty && !(await saveProfile({ quiet: true }))) return;
      const response = await fetch("/api/phone-front-desk/calendar", {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "verify" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Google Calendar verification failed.");
      setCalendarVerified(true);
      setNotice("Calendar availability and event-editing access verified. Complete one test booking before using it with clients.");
    } catch (verifyError) {
      setCalendarVerified(false);
      setError(verifyError instanceof Error ? verifyError.message : "Google Calendar verification failed.");
    }
    finally { setVerifyingCalendar(false); }
  }, [canConfigure, dirty, saveProfile]);

  const connectGoogle = useCallback(async (kind) => {
    if (!canConfigure || !integrationsEnabled || !calendar.configured) return;
    setError("");
    if (dirty && !(await saveProfile({ quiet: true }))) return;
    window.location.assign(`/api/phone-front-desk/google/connect?kind=${kind}`);
  }, [calendar.configured, canConfigure, dirty, integrationsEnabled, saveProfile]);

  const connectionAction = useCallback(async (action, input = {}) => {
    setConnectionBusy(action);
    setError("");
    try {
      const response = await fetch("/api/phone-front-desk/google/connections", {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...input }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Connection request failed.");
      if (action === "select-calendar") {
        setCalendar((current) => ({ ...current, ...data.connections.calendar }));
        setProfile((current) => ({ ...current, calendarId: data.selected.id, timeZone: data.selected.timeZone }));
        setCalendarVerified(false);
        setNotice(`Using ${data.selected.name} for appointments.`);
      } else if (action === "set-time-zone") {
        setCalendar((current) => ({ ...current, ...data.connections.calendar }));
        setProfile((current) => ({ ...current, timeZone: data.selected.timeZone }));
        setBookingTimeZone(data.selected.timeZone);
        setNotice(`Booking times now use ${data.selected.timeZone}. Your Google Calendar settings were not changed.`);
      } else setNotice("Test email sent from your connected Gmail account to its inbox.");
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Connection request failed."); }
    finally { setConnectionBusy(""); }
  }, []);

  const disconnectGoogle = useCallback(async (kind) => {
    if (!window.confirm(`Disconnect ${kind === "mail" ? "Gmail" : "Google Calendar"}? Automated ${kind === "mail" ? "emails" : "booking"} will stop.`)) return;
    setConnectionBusy(`disconnect-${kind}`);
    setError("");
    try {
      const response = await fetch(`/api/phone-front-desk/google/connections?kind=${kind}`, { method: "DELETE", credentials: "include" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not disconnect Google.");
      if (kind === "mail") setNotifications((current) => ({ ...current, ...data.connections.mail }));
      else {
        setCalendar((current) => ({ ...current, ...data.connections.calendar }));
        setProfile((current) => ({ ...current, calendarId: "" }));
        setCalendarVerified(false);
      }
      setNotice(`${kind === "mail" ? "Gmail" : "Google Calendar"} disconnected.`);
    } catch (disconnectError) { setError(disconnectError instanceof Error ? disconnectError.message : "Could not disconnect Google."); }
    finally { setConnectionBusy(""); }
  }, []);

  const retrySummaryEmail = useCallback(async (id) => {
    try {
      const response = await fetch(`/api/phone-front-desk/summary/${encodeURIComponent(id)}`, { method: "POST", credentials: "include" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not retry the summary email.");
      setCalls((current) => current.map((call) => call.id === id ? data.call : call));
      if (data.call.emailStatus === "sent") setNotice("Call summary email sent.");
      else throw new Error(data.call.emailStatus === "skipped" ? "Connect business Gmail before sending this summary." : data.call.emailError || "Call summary email is still pending.");
    } catch (retryError) { setError(retryError instanceof Error ? retryError.message : "Could not retry the summary email."); }
  }, []);

  const captureLeadTool = useCallback(async (args = {}) => {
    setLead((current) => ({
      callerName: cleanText(args.caller_name) || current.callerName,
      callerPhone: cleanText(args.caller_phone) || current.callerPhone,
      reason: cleanText(args.reason) || current.reason,
      urgency: ["low", "normal", "high"].includes(args.urgency) ? args.urgency : current.urgency,
    }));
    if (integrationsEnabled && args.urgency === "high" && conversationIdRef.current) {
      try {
        const response = await fetch("/api/phone-front-desk/alert", {
          method: "POST", credentials: "include", headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversationId: conversationIdRef.current, callerName: args.caller_name, callerPhone: args.caller_phone, reason: args.reason }),
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok && data.status === "sent") return "Urgent alert emailed to the business. Lead details saved.";
        return "Lead details saved, but the urgent email could not be delivered. Ask the caller to contact the business directly for immediate help.";
      } catch { return "Lead details saved, but the urgent email could not be delivered. Ask the caller to contact the business directly for immediate help."; }
    }
    return "Lead details saved for the call summary.";
  }, [integrationsEnabled]);

  const prepareAppointmentTool = useCallback((args = {}) => {
    setAppointment({
      service: cleanText(args.service),
      preferredDate: cleanText(args.preferred_date),
      preferredTime: cleanText(args.preferred_time),
      notes: cleanText(args.notes),
      status: "requested",
    });
    return "Appointment request prepared. It is not a confirmed booking.";
  }, []);

  const calendarTool = useCallback(async (action, args = {}) => {
    if (!integrationsEnabled) throw new Error("Live calendar booking is not enabled.");
    const response = await fetch("/api/phone-front-desk/calendar", {
      method: "POST", credentials: "include", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action, date: args.date, time: args.time, service: args.service,
        conversationId: conversationIdRef.current,
        callerName: args.caller_name, callerPhone: args.caller_phone,
        callerConfirmed: args.caller_confirmed === true,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Google Calendar is unavailable.");
    return data;
  }, [integrationsEnabled]);

  const checkAvailabilityTool = useCallback(async (args = {}) => {
    try {
      const data = await calendarTool("check", args);
      return data.available
        ? `Available: ${args.date} at ${args.time} in ${data.timeZone}. Ask whether the caller wants this exact slot booked. Do not call it confirmed yet.`
        : `Busy: ${args.date} at ${args.time}. Ask the caller for another time.`;
    } catch (error) { return `Could not verify availability: ${error.message} Take an unconfirmed appointment request instead.`; }
  }, [calendarTool]);

  const bookAppointmentTool = useCallback(async (args = {}) => {
    try {
      const data = await calendarTool("book", args);
      if (!data.booked) return data.reason || "This time could not be booked. Ask for another time.";
      setAppointment({
        service: cleanText(args.service), preferredDate: cleanText(args.date), preferredTime: cleanText(args.time),
        notes: "Confirmed in Google Calendar", status: "booked", eventId: data.eventId,
      });
      setLead((current) => ({ ...current, callerName: cleanText(args.caller_name) || current.callerName, callerPhone: cleanText(args.caller_phone) || current.callerPhone }));
      return `Booked successfully in Google Calendar for ${args.date} at ${args.time} ${profile?.timeZone || ""}. You may now tell the caller the appointment is confirmed.`;
    } catch (error) { return `Booking failed: ${error.message} Do not say it is confirmed. Take an unconfirmed appointment request instead.`; }
  }, [calendarTool, profile?.timeZone]);

  const requestHandoffTool = useCallback((args = {}) => {
    setHandoffRequested(true);
    if (args.reason) {
      setLead((current) => ({
        ...current,
        reason: current.reason || cleanText(args.reason),
        urgency: ["low", "normal", "high"].includes(args.urgency) ? args.urgency : current.urgency,
      }));
    }
    return "Human callback requested. This browser demo cannot complete a live phone transfer.";
  }, []);

  const clientTools = useMemo(() => ({
    capture_lead: captureLeadTool,
    prepare_appointment: prepareAppointmentTool,
    check_availability: checkAvailabilityTool,
    book_appointment: bookAppointmentTool,
    request_human_handoff: requestHandoffTool,
  }), [bookAppointmentTool, captureLeadTool, checkAvailabilityTool, prepareAppointmentTool, requestHandoffTool]);

  const handleConversationMessage = useCallback(({ message, role, source }) => {
    const text = cleanText(message);
    if (!text) return;
    const mappedRole = role === "agent" || source === "ai" ? "assistant" : "caller";
    const latest = transcriptRef.current.at(-1);
    if (latest?.role !== mappedRole || latest?.text !== text) pushTranscript({ role: mappedRole, text });
    if (mappedRole === "assistant") setTypedSending(false);
  }, [pushTranscript]);

  const fetchConversationSession = useCallback(async () => {
    const response = await fetch("/api/phone-front-desk/session", { method: "POST", credentials: "include" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Unable to create the secure ElevenLabs session.");
    return data;
  }, []);

  const conversationCallbacks = useCallback((mode) => ({
    onMessage: handleConversationMessage,
    onModeChange: ({ mode: activeMode }) => {
      setInputCaption(activeMode === "listening" && mode === "voice" ? "Listening…" : "");
      setOutputCaption(activeMode === "speaking" && mode === "voice" ? "Speaking…" : "");
    },
    onError: (message) => failLiveCall(cleanText(message) || "The ElevenLabs conversation was interrupted."),
    onDisconnect: (details) => {
      if (!endingRef.current && ["live", "typed"].includes(stateRef.current)) {
        failLiveCall(details?.message || "The ElevenLabs conversation ended unexpectedly. Please start another call.");
      }
    },
  }), [failLiveCall, handleConversationMessage]);

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
      const permissionStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      permissionStream.getTracks().forEach((track) => track.stop());
      const data = await fetchConversationSession();
      callModeRef.current = "voice";
      startedAtRef.current = Date.now();
      const session = await Conversation.startSession({
        conversationToken: data.conversationToken,
        connectionType: "webrtc",
        dynamicVariables: data.dynamicVariables,
        clientTools,
        ...conversationCallbacks("voice"),
      });
      sessionRef.current = session;
      conversationIdRef.current = session.getId();
      endingRef.current = false;
      setCallState("live");
    } catch (startError) {
      stopResources();
      endingRef.current = false;
      setError(startError instanceof Error ? startError.message : "Unable to start the live demo call.");
      setCallState("error");
    }
  }, [canConfigure, canOperate, clientTools, conversationCallbacks, dirty, fetchConversationSession, resetCall, saveProfile, setCallState, stopResources]);

  const startTypedCall = useCallback(async () => {
    if (!canOperate || !profile || stateRef.current === "preparing") return;
    setCallState("preparing");
    setNotice("");
    try {
      if (dirty && canConfigure) {
        const saved = await saveProfile({ quiet: true });
        if (!saved) throw new Error("Save the receptionist profile before starting the call.");
      }
      resetCall();
      setCallState("preparing");
      const data = await fetchConversationSession();
      callModeRef.current = "typed";
      startedAtRef.current = Date.now();
      const session = await Conversation.startSession({
        signedUrl: data.signedUrl,
        connectionType: "websocket",
        textOnly: true,
        dynamicVariables: data.dynamicVariables,
        clientTools,
        ...conversationCallbacks("typed"),
      });
      sessionRef.current = session;
      conversationIdRef.current = session.getId();
      endingRef.current = false;
      setCallState("typed");
    } catch (startError) {
      stopResources();
      endingRef.current = false;
      setError(startError instanceof Error ? startError.message : "Unable to start the typed demo.");
      setCallState("error");
    }
  }, [canConfigure, canOperate, clientTools, conversationCallbacks, dirty, fetchConversationSession, profile, resetCall, saveProfile, setCallState, stopResources]);

  const sendTypedMessage = useCallback(async () => {
    const message = cleanText(typedMessage);
    if (!message || typedSending || stateRef.current !== "typed") return;
    setTypedMessage("");
    setTypedSending(true);
    pushTranscript({ role: "caller", text: message });
    try {
      if (!sessionRef.current) throw new Error("The typed conversation is no longer connected.");
      sessionRef.current.sendUserMessage(message);
    } catch (sendError) {
      setTypedSending(false);
      setError(sendError instanceof Error ? sendError.message : "The receptionist could not respond.");
    }
  }, [pushTranscript, typedMessage, typedSending]);

  const finishCall = useCallback(async () => {
    if (!["live", "typed", "error"].includes(stateRef.current)) return;
    const mode = callModeRef.current;
    const conversationId = conversationIdRef.current;
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
          conversationId,
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
      setError("");
      setNotice(!integrationsEnabled
        ? "Call complete. The lead and follow-up summary are saved below."
        : data.call.emailStatus === "sent"
          ? "Call saved and summary emailed to the business."
          : "Call saved. Summary email needs attention; use Retry email below.");
      setCallState("completed");
    } catch (finishError) {
      setError(finishError instanceof Error ? finishError.message : "Unable to prepare the call summary.");
      setCallState("error");
    } finally {
      endingRef.current = false;
    }
  }, [appointment, handoffRequested, integrationsEnabled, lead, setCallState, stopResources]);

  useEffect(() => {
    if (state !== "error" || autoFinalizeAttemptedRef.current || !conversationIdRef.current || !transcriptRef.current.length) return;
    autoFinalizeAttemptedRef.current = true;
    void finishCall();
  }, [finishCall, state]);

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
            <span><span className="pfd-engine-dot" />{configured ? "ElevenLabs AI ready" : "ElevenLabs setup needed"}</span>
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
        <article><span><CalendarCheck size={18} /></span><div><small>Appointments</small><strong>{stats.appointments}</strong></div></article>
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
            {integrationsEnabled && <>
              <Field label="Send summaries to" hint="business inbox"><input type="email" value={profile.notificationEmail} disabled={!canConfigure || callActive} onChange={(event) => updateProfile("notificationEmail", event.target.value)} /></Field>
              <Field label="Appointment length" hint="minutes"><input type="number" min="15" max="180" value={profile.durationMinutes || 60} disabled={!canConfigure || callActive} onChange={(event) => updateProfile("durationMinutes", Number(event.target.value))} /></Field>
            </>}
          </div>
          {integrationsEnabled && <div className="pfd-connections">
            <div className="pfd-connection-card">
              <strong><CalendarCheck size={16} />Google Calendar</strong>
              <p>{calendar.connected ? `Connected as ${calendar.email}. Appointments use your selected calendar and its time zone.` : calendar.configured ? "Connect your Google account to book appointments automatically." : "Google OAuth needs to be configured by the platform owner."}</p>
              {calendar.connected && <label>Booking calendar
                <select value={calendar.calendarId || ""} onChange={(event) => void connectionAction("select-calendar", { calendarId: event.target.value })} disabled={!canConfigure || callActive || Boolean(connectionBusy)}>
                  {calendarOptions.length === 0 && <option value={calendar.calendarId || ""}>{calendar.calendarId || "Loading calendars…"}</option>}
                  {calendarOptions.map((item) => <option value={item.id} key={item.id}>{item.name}{item.primary ? " (primary)" : ""}</option>)}
                </select>
              </label>}
              {calendar.connected && <>
                <label>Booking time zone
                  <input list="pfd-booking-time-zones" value={bookingTimeZone} onChange={(event) => setBookingTimeZone(event.target.value)} placeholder="e.g. Asia/Kolkata" disabled={!canConfigure || callActive || Boolean(connectionBusy)} />
                </label>
                <datalist id="pfd-booking-time-zones">{timeZoneOptions.map((zone) => <option value={zone} key={zone} />)}</datalist>
                <small>The assistant uses this time zone for appointments. Your Google Calendar settings stay unchanged.</small>
                {calendarVerified && <small className="pfd-connection-verified"><CheckCircle2 size={13} /> Calendar access verified</small>}
              </>}
              <div className="pfd-connection-actions">
                {!calendar.connected ? <button type="button" onClick={() => void connectGoogle("calendar")} disabled={!canConfigure || callActive || saving || !calendar.configured}>Connect Google Calendar</button> : <>
                  <button type="button" onClick={() => void connectionAction("set-time-zone", { timeZone: bookingTimeZone })} disabled={!canConfigure || callActive || saving || Boolean(connectionBusy) || bookingTimeZone.trim() === calendar.timeZone}>{connectionBusy === "set-time-zone" ? "Saving…" : "Save time zone"}</button>
                  <button type="button" onClick={() => void verifyCalendar()} disabled={!canConfigure || callActive || saving || verifyingCalendar || Boolean(connectionBusy)}>{verifyingCalendar ? "Checking…" : "Verify access"}</button>
                  <button type="button" className="pfd-disconnect" onClick={() => void disconnectGoogle("calendar")} disabled={!canConfigure || callActive || Boolean(connectionBusy)}>Disconnect</button>
                </>}
              </div>
            </div>
            <div className="pfd-connection-card">
              <strong><Mail size={16} />Business Gmail</strong>
              <p>{notifications.connected ? `Connected as ${notifications.email}. Call summaries and urgent alerts will send from this mailbox.` : notifications.configured ? "Connect the business Gmail account to send follow-up emails from it." : "Google OAuth needs to be configured by the platform owner."}</p>
              <div className="pfd-connection-actions">
                {!notifications.connected ? <button type="button" onClick={() => void connectGoogle("mail")} disabled={!canConfigure || callActive || saving || !notifications.configured}>Connect Gmail</button> : <>
                  <button type="button" onClick={() => void connectionAction("test-mail")} disabled={!canConfigure || callActive || Boolean(connectionBusy)}>{connectionBusy === "test-mail" ? "Sending…" : "Send test email"}</button>
                  <button type="button" className="pfd-disconnect" onClick={() => void disconnectGoogle("mail")} disabled={!canConfigure || callActive || Boolean(connectionBusy)}>Disconnect</button>
                </>}
              </div>
            </div>
          </div>}
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
                {state === "error" && autoFinalizeAttemptedRef.current && conversationIdRef.current && transcriptRef.current.length > 0 && (
                  <button className="pfd-secondary-call" type="button" onClick={() => void finishCall()} disabled={!canOperate}>
                    Save interrupted call
                  </button>
                )}
              </div>
              {!configured && <small className="pfd-stage-warning">Add ELEVENLABS_API_KEY in Netlify to enable the AI voice and typed demonstrations.</small>}
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
                <span>{state === "live" ? <><Volume2 size={15} />ElevenLabs Voice AI</> : <><Keyboard size={15} />ElevenLabs Chat</>}</span>
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
              <span><CalendarCheck size={18} /></span><div><small>{integrationsEnabled && appointment?.status === "booked" ? "Booked in Google Calendar" : "Appointment request"}</small><strong>{appointment?.service || "No request yet"}</strong><p>{appointment ? [appointment.preferredDate, appointment.preferredTime].filter(Boolean).join(" · ") || "Details captured" : "Date and time will appear here"}</p></div>{appointment && <Check size={15} />}
            </article>
            <article className={handoffRequested ? "pfd-capture-card is-ready" : "pfd-capture-card"}>
              <span><PhoneForwarded size={18} /></span><div><small>Human follow-up</small><strong>{handoffRequested ? "Callback requested" : "Not requested"}</strong><p>{profile.transferNumber ? `Team number: ${profile.transferNumber}` : "Add a team number in the profile"}</p></div>{handoffRequested && <Check size={15} />}
            </article>
          </div>
          <div className="pfd-demo-note"><Sparkles size={17} /><div><strong>Demo-safe by design</strong><p>{integrationsEnabled ? "Appointments are confirmed only after Google Calendar creates an event. Human transfer still means a callback request." : "Appointment requests and transfers are saved for follow-up, not booked or connected to a live phone line."}</p></div></div>
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
                <div className="pfd-history-outcome"><span className={`pfd-urgency pfd-urgency-${call.urgency}`}>{call.urgency}</span><small>{integrationsEnabled && call.appointment?.status === "booked" ? "Calendar booked" : formatDuration(call.durationSeconds)}</small>{integrationsEnabled && <><small>{call.emailStatus === "sent" ? "Email sent" : call.emailStatus === "skipped" ? "Email not connected" : call.emailStatus === "failed" ? "Email failed" : "Email pending"}</small>{canOperate && ["failed", "pending", "skipped"].includes(call.emailStatus) && <button type="button" onClick={() => void retrySummaryEmail(call.id)}>Retry email</button>}</>}</div>
                <ChevronRight size={18} />
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
