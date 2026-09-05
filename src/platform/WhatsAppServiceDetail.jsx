"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Bot,
  CalendarClock,
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  FileCheck2,
  Inbox,
  LockKeyhole,
  Megaphone,
  MessageCircleMore,
  MoreHorizontal,
  Paperclip,
  Search,
  Send,
  ShieldCheck,
  UsersRound,
  Workflow,
} from "lucide-react";
import { FaMeta } from "react-icons/fa6";
import {
  PiAddressBookBold,
  PiBriefcaseBold,
  PiChartLineUpBold,
  PiChatsCircleBold,
  PiClockCountdownBold,
  PiFingerprintBold,
  PiHeadsetBold,
  PiLockKeyBold,
  PiMegaphoneBold,
} from "react-icons/pi";
import { useEffect, useState } from "react";
import ProductShell from "./ProductShell";
import { useProductStatus } from "./use-product-status";
import styles from "./whatsapp-service-detail.module.css";

const demoViews = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "campaigns", label: "Campaigns", icon: Megaphone },
  { id: "templates", label: "Templates", icon: FileCheck2 },
  { id: "automations", label: "Automations", icon: Workflow },
];

const connectionModes = [
  {
    id: "cloud",
    label: "Meta business account",
    shortLabel: "Cloud API",
    mark: "M",
    eyebrow: "DIRECT META CONNECTION",
    title: "Connect directly with Meta",
    description: "Choose this if you set up WhatsApp through your Facebook or Meta business account.",
    account: "Meta WhatsApp account",
  },
  {
    id: "wati",
    label: "WATI account",
    shortLabel: "WATI",
    mark: "W",
    eyebrow: "EXISTING PROVIDER CONNECTION",
    title: "Connect your WATI account",
    description: "Choose this if your business already sends and receives WhatsApp messages through WATI.",
    account: "Your WATI account",
  },
  {
    id: "coexistence",
    label: "WhatsApp Business app",
    shortLabel: "Business app",
    mark: "A",
    eyebrow: "APP + API TOGETHER",
    title: "Keep using the WhatsApp Business app",
    description: "Choose this if you want to keep using the mobile app while AgenticThat helps with team work and automation.",
    account: "WhatsApp Business app",
  },
];

// The workspace only exists once a provider is linked, so an unconnected
// account gets a clear instruction instead of a button that leads nowhere.
const SETUP_INSTRUCTION = "Set up your WhatsApp account first. Add the connection in Connections — the workspace opens as soon as Meta or WATI is linked.";
const CONTINUE_INSTRUCTION = "Your WhatsApp connection is not finished yet. Complete it in Connections, then open the workspace from here.";

function actionFor(status, service) {
  if (status.state === "checking") return { label: "Checking connection", disabled: true };
  if (status.state === "connected") return { label: "Open WhatsApp workspace", href: service.dashboardHref };
  return { label: "Open WhatsApp workspace", disabled: true };
}

function setupInstructionFor(status) {
  return status.state === "continue" ? CONTINUE_INSTRUCTION : SETUP_INSTRUCTION;
}

function DemoAvatar({ tone = "green", src, alt = "" }) {
  return <span className={`${styles.demoAvatar} ${styles[`demoAvatar_${tone}`]}`}><img src={src} alt={alt} /></span>;
}

function ConnectionBrand({ id }) {
  if (id === "cloud") return <FaMeta aria-hidden="true" />;
  if (id === "wati") return <img src="/wati-logo.svg" alt="" />;
  return <img src="/whatsapp-logo.svg" alt="" />;
}

function InboxDemo() {
  const chats = [
    { id: "maya", avatar: "/avatars/maya-rao.svg", tone: "green", name: "Maya Rao", preview: "Is my appointment confirmed?", time: "10:24", incoming: "Is my appointment confirmed for today?", outgoing: "Yes—your appointment is confirmed for 4:00 PM." },
    { id: "arjun", avatar: "/avatars/arjun-kumar.svg", tone: "sand", name: "Arjun Kumar", preview: "Can you share the tracking link?", time: "9:48", incoming: "Can you share the tracking link for my order?", outgoing: "Of course. Your order is on the way—I’ve shared the live link." },
    { id: "priya", avatar: "/avatars/priya-shah.svg", tone: "blue", name: "Priya Shah", preview: "I need help choosing a plan.", time: "Mon", incoming: "Which plan works best for a five-person team?", outgoing: "The Team plan will give everyone a shared inbox and clear ownership." },
  ];
  const [selectedId, setSelectedId] = useState("maya");
  const [sent, setSent] = useState(false);
  const selected = chats.find((chat) => chat.id === selectedId) || chats[0];

  useEffect(() => {
    const currentIndex = chats.findIndex((chat) => chat.id === selectedId);
    const timer = window.setTimeout(() => {
      setSelectedId(chats[(currentIndex + 1) % chats.length].id);
      setSent(false);
    }, 3900);
    return () => window.clearTimeout(timer);
  }, [selectedId]);

  return (
    <div className={styles.inboxDemo}>
      <aside className={styles.demoConversationList}>
        <div className={styles.demoSearch}><Search size={14} /><span>Search conversations</span></div>
        <div className={styles.demoFilters}><span>All <b>126</b></span><span>Unread 15</span><span>Mine 8</span></div>
        {chats.map((chat) => (
          <button className={selectedId === chat.id ? styles.demoConversationActive : ""} type="button" onClick={() => { setSelectedId(chat.id); setSent(false); }} key={chat.id}>
            <DemoAvatar src={chat.avatar} alt={chat.name} tone={chat.tone} />
            <span><strong>{chat.name}</strong><small>{chat.preview}</small></span>
            <time>{chat.time}</time>
          </button>
        ))}
      </aside>
      <section className={styles.demoChat}>
        <header><DemoAvatar src={selected.avatar} alt={selected.name} tone={selected.tone} /><span><strong>{selected.name}</strong><small>Online</small></span><MoreHorizontal size={17} /></header>
        <div className={styles.demoMessages} key={selected.id}>
          <div>{selected.incoming}<small>10:24 AM</small></div>
          <div>{selected.outgoing}<small>10:25 AM <Check size={11} /></small></div>
          {sent ? <div>Anything else I can help you with?<small>Just now <Check size={11} /></small></div> : null}
        </div>
        <div className={styles.demoComposer}><Paperclip size={16} /><span>Type a message…</span><button type="button" aria-label="Send sample reply" onClick={() => setSent(true)}><Send size={15} /></button></div>
      </section>
    </div>
  );
}

function CampaignsDemo() {
  const stages = [
    { id: "audience", label: "Audience", icon: UsersRound },
    { id: "message", label: "Message", icon: FileCheck2 },
    { id: "schedule", label: "Schedule", icon: CalendarClock },
  ];
  const [stage, setStage] = useState("audience");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const currentIndex = stages.findIndex((item) => item.id === stage);
    const timer = window.setTimeout(() => setStage(stages[(currentIndex + 1) % stages.length].id), 3900);
    return () => window.clearTimeout(timer);
  }, [stage]);

  return (
    <div className={styles.campaignsDemo}>
      <section className={styles.demoCampaignBuilder}>
        <header><span><small>CAMPAIGN DRAFT</small><strong>Appointment reminders</strong></span><em className={ready ? styles.demoReady : ""}>{ready ? "Ready" : "Draft"}</em></header>
        <nav>
          {stages.map((item, index) => {
            const Icon = item.icon;
            return <button className={stage === item.id ? styles.demoStageActive : ""} type="button" onClick={() => setStage(item.id)} key={item.id}><i>{index + 1}</i><Icon size={15} />{item.label}</button>;
          })}
        </nav>
        <div className={styles.demoCampaignCanvas} key={stage}>
          {stage === "audience" ? <div className={styles.demoAudience}><span><UsersRound size={21} /></span><div><small>SELECTED AUDIENCE</small><strong>Upcoming appointments</strong><p>Confirmed customers in the next 24 hours.</p></div><b>248<small>recipients</small></b></div> : null}
          {stage === "message" ? <div className={styles.demoMessageEditor}><span><BadgeCheck size={16} />Approved template</span><strong>appointment_confirmation</strong><p>Hi {"{{1}}"}, your appointment is confirmed for {"{{2}}"}. Reply HELP if you need assistance.</p></div> : null}
          {stage === "schedule" ? <div className={styles.demoSchedule}><div><CalendarClock size={21} /><span><small>DELIVERY TIME</small><strong>Tomorrow, 9:00 AM</strong></span></div><div><ShieldCheck size={21} /><span><small>SEND MODE</small><strong>Controlled delivery</strong></span></div></div> : null}
        </div>
        <footer><span><CircleCheck size={16} />Required details complete</span><button type="button" onClick={() => setReady(true)}>{ready ? "Campaign ready" : "Review campaign"}<ArrowRight size={14} /></button></footer>
      </section>
      <aside className={styles.demoDeliveryPanel}>
        <span>LIVE DELIVERY</span>
        <strong>85%</strong>
        <p>Appointment reminder</p>
        <div><i /><i /><i /><i /><i /></div>
        <dl><div><dt>Delivered</dt><dd>212</dd></div><div><dt>Read</dt><dd>176</dd></div><div><dt>Pending</dt><dd>36</dd></div></dl>
      </aside>
    </div>
  );
}

function TemplatesDemo() {
  const templates = [
    { id: "appointment", name: "Appointment confirmation", code: "appointment_confirmation", body: "Hi Maya, your appointment is confirmed for tomorrow at 4:00 PM." },
    { id: "order", name: "Order ready", code: "order_ready", body: "Good news, Maya. Order #45692 is ready for collection." },
    { id: "followup", name: "Service follow-up", code: "service_follow_up", body: "Hi Maya, how was your recent appointment with our team?" },
  ];
  const [selectedId, setSelectedId] = useState("appointment");
  const [chosen, setChosen] = useState(false);
  const selected = templates.find((item) => item.id === selectedId) || templates[0];

  useEffect(() => {
    const currentIndex = templates.findIndex((item) => item.id === selectedId);
    const timer = window.setTimeout(() => {
      setSelectedId(templates[(currentIndex + 1) % templates.length].id);
      setChosen(false);
    }, 3900);
    return () => window.clearTimeout(timer);
  }, [selectedId]);

  return (
    <div className={styles.templatesDemo}>
      <aside className={styles.demoTemplateList}>
        <div className={styles.demoSearch}><Search size={14} /><span>Search templates</span></div>
        {templates.map((template) => (
          <button className={selectedId === template.id ? styles.demoTemplateActive : ""} type="button" onClick={() => { setSelectedId(template.id); setChosen(false); }} key={template.id}>
            <FileCheck2 size={17} /><span><strong>{template.name}</strong><small>{template.code}</small></span><BadgeCheck size={14} />
          </button>
        ))}
      </aside>
      <section className={styles.demoTemplatePreview} key={selected.id}>
        <header><span><small>APPROVED · UTILITY</small><strong>{selected.name}</strong></span><em>English</em></header>
        <div className={styles.demoTemplatePhone}><div>{selected.body}<small>10:25 AM <Check size={11} /></small></div></div>
        <div className={styles.demoVariables}><span>{"{{1}}"} Customer name</span><span>{"{{2}}"} Dynamic value</span></div>
        <button type="button" onClick={() => setChosen(true)}>{chosen ? "Template selected" : "Use this template"}<ArrowRight size={14} /></button>
      </section>
    </div>
  );
}

function AutomationsDemo() {
  const steps = [
    { id: "trigger", label: "New message received", detail: "Any WhatsApp conversation", icon: MessageCircleMore },
    { id: "reply", label: "Send welcome reply", detail: "Approved quick response", icon: Bot },
    { id: "owner", label: "Assign customer care", detail: "Round-robin ownership", icon: UsersRound },
  ];
  const [selectedId, setSelectedId] = useState("trigger");
  const [active, setActive] = useState(true);
  const selected = steps.find((item) => item.id === selectedId) || steps[0];
  const SelectedIcon = selected.icon;

  useEffect(() => {
    const currentIndex = steps.findIndex((item) => item.id === selectedId);
    const timer = window.setTimeout(() => setSelectedId(steps[(currentIndex + 1) % steps.length].id), 3900);
    return () => window.clearTimeout(timer);
  }, [selectedId]);

  return (
    <div className={styles.automationsDemo}>
      <section className={styles.demoAutomationFlow}>
        <header><span><small>AUTOMATION</small><strong>New enquiry follow-up</strong></span><button className={active ? styles.demoToggleOn : ""} type="button" onClick={() => setActive(!active)}><i />{active ? "Active" : "Paused"}</button></header>
        <div>
          {steps.map((step, index) => {
            const Icon = step.icon;
            return <div className={styles.demoFlowGroup} key={step.id}><button className={selectedId === step.id ? styles.demoFlowActive : ""} type="button" onClick={() => setSelectedId(step.id)}><span><Icon size={18} /></span><div><strong>{step.label}</strong><small>{step.detail}</small></div><ChevronRight size={15} /></button>{index < steps.length - 1 ? <i /> : null}</div>;
          })}
        </div>
      </section>
      <aside className={styles.demoInspector} key={selected.id}><span><SelectedIcon size={22} /></span><small>SELECTED STEP</small><strong>{selected.label}</strong><p>{selected.detail}. The team can review and change this step at any time.</p><dl><div><dt>Channel</dt><dd>WhatsApp</dd></div><div><dt>Control</dt><dd>Team managed</dd></div></dl></aside>
    </div>
  );
}

function HeroProductDemo() {
  const [activeView, setActiveView] = useState("inbox");
  const activeIndex = demoViews.findIndex((item) => item.id === activeView);
  const activeItem = demoViews[activeIndex] || demoViews[0];
  const content = {
    inbox: <InboxDemo />,
    campaigns: <CampaignsDemo />,
    templates: <TemplatesDemo />,
    automations: <AutomationsDemo />,
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextIndex = (activeIndex + 1) % demoViews.length;
      setActiveView(demoViews[nextIndex].id);
    }, 9400);
    return () => window.clearTimeout(timer);
  }, [activeIndex]);

  return (
    <div className={styles.heroDemo}>
      <aside className={styles.demoRail} aria-label="WhatsApp product views">
        <img src="/whatsapp-logo.svg" alt="" />
        {demoViews.map((view) => {
          const Icon = view.icon;
          return <button className={activeView === view.id ? styles.demoRailActive : ""} type="button" aria-label={`Show ${view.label}`} aria-pressed={activeView === view.id} onClick={() => setActiveView(view.id)} key={view.id}><Icon size={18} strokeWidth={1.9} /><span>{view.label}</span></button>;
        })}
        <span className={styles.demoSecure}><LockKeyhole size={17} /></span>
      </aside>
      <section className={styles.demoWorkspace}>
        <header>
          <div><strong>WhatsApp</strong><span><i />Live workspace</span></div>
          <aside><button type="button" onClick={() => setActiveView("templates")}>Templates</button><button type="button" onClick={() => setActiveView("campaigns")}>New campaign</button></aside>
        </header>
        <div className={styles.demoViewTitle}><span>{activeItem.label}</span><small>Live product preview</small></div>
        <div className={styles.demoViewport}>
          {demoViews.map((view) => (
            <div className={`${styles.demoScene} ${activeView === view.id ? styles.demoSceneActive : ""}`} aria-hidden={activeView !== view.id} key={view.id}>
              {content[view.id]}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ServiceOverview() {
  const uses = [
    [PiChatsCircleBold, "Reply to customers", "Read and answer customer messages together from one shared inbox."],
    [PiMegaphoneBold, "Send useful updates", "Send reminders, order updates, announcements, and approved campaigns."],
    [PiAddressBookBold, "Keep contacts organized", "See each customer’s name, number, message history, and follow-up details."],
    [PiClockCountdownBold, "Save time on repeat work", "Use simple automatic replies and follow-ups for common customer questions."],
  ];

  return (
    <section className={styles.overviewSection} id="capabilities">
      <header className={styles.sectionIntro}>
        <h2>Everything you need to manage customer messages.</h2>
        <p>Instead of checking different phones, contact lists, and tools, your team can handle everyday WhatsApp work in one place.</p>
      </header>
      <div className={styles.useGrid}>
        {uses.map(([Icon, title, description]) => <article key={title}><span><Icon size={23} strokeWidth={1.9} /></span><h3>{title}</h3><p>{description}</p></article>)}
      </div>
    </section>
  );
}

function AudienceGuide() {
  const audiences = [
    [PiBriefcaseBold, "Business owners", "Manage enquiries and customer updates without sharing one phone."],
    [PiHeadsetBold, "Customer support teams", "See who is replying and keep every conversation in one place."],
    [PiChartLineUpBold, "Sales and marketing teams", "Follow up with leads and send approved messages to the right people."],
  ];

  return (
    <section className={styles.guideSection}>
      <div className={styles.audiencePanel}>
        <header><h2>Who can use it?</h2><p>Any business that talks to customers on WhatsApp. If your team can use WhatsApp, they can use this workspace.</p></header>
        <div className={styles.audienceList}>
          {audiences.map(([Icon, title, description]) => <article key={title}><i><Icon size={24} /></i><strong>{title}</strong><span>{description}</span></article>)}
        </div>
      </div>
      <div className={styles.startPanel}>
        <header><h2>How do you start?</h2><p>No coding or technical setup knowledge is required.</p></header>
        <ol>
          <li><span>1</span><div><strong>Connect your WhatsApp account</strong><p>Choose Meta, WATI, or your existing business app setup.</p></div></li>
          <li><span>2</span><div><strong>Choose what you want to do</strong><p>Reply to messages, send an update, or prepare a follow-up.</p></div></li>
          <li><span>3</span><div><strong>Start working with your team</strong><p>Everyone can see the message, owner, and delivery status.</p></div></li>
        </ol>
      </div>
    </section>
  );
}

function ConnectionSection({ configHref, ctaLabel }) {
  const [modeId, setModeId] = useState("cloud");
  const mode = connectionModes.find((item) => item.id === modeId) || connectionModes[0];

  return (
    <section className={styles.simpleConnection} id="connections">
      <header className={styles.sectionIntro}><h2>How is your WhatsApp set up?</h2><p>Pick the option your business already uses, then add it on the Connections page. The Connection Manager verifies the account and unlocks the workspace.</p></header>
      <div className={styles.connectionChooser}>
        <nav aria-label="Connection options">
          {connectionModes.map((item) => <button className={modeId === item.id ? styles.connectionChoiceActive : ""} type="button" onClick={() => setModeId(item.id)} key={item.id}><span className={styles.connectionBrand}><ConnectionBrand id={item.id} /></span><strong>{item.label}</strong></button>)}
        </nav>
        <article className={styles.connectionAnswer} key={mode.id}>
          <span className={styles.connectionMark}><ConnectionBrand id={mode.id} /></span>
          <div><small>Choose this option if it matches your current setup</small><h3>{mode.title}</h3><p>{mode.description}</p></div>
          <p className={styles.connectionResult}><span>{mode.account}</span><ArrowRight size={18} /><strong>AgenticThat ready</strong></p>
        </article>
      </div>
      <div className={styles.connectionCta}>
        <Link href={configHref}>{ctaLabel}<ArrowRight size={18} /></Link>
      </div>
    </section>
  );
}

function SecuritySection() {
  return (
    <section className={styles.simpleTrust}>
      <span><PiFingerprintBold size={32} /></span>
      <div><h2>Your WhatsApp account stays protected.</h2><p>Your login details are encrypted and kept private. Your team can use the workspace without seeing or sharing sensitive account information.</p></div>
      <strong><PiLockKeyBold size={18} />Encrypted and private</strong>
    </section>
  );
}

export default function WhatsAppServiceDetail({ user, service }) {
  const { statusFor } = useProductStatus();
  const status = statusFor(service);
  const action = actionFor(status, service);
  const connected = status.state === "connected";
  const needsConnection = !connected && status.state !== "checking";
  const setupInstruction = setupInstructionFor(status);
  const setupLabel = status.state === "continue" ? "Continue setup" : "Set up WhatsApp account";

  return (
    <ProductShell user={user} active="apps">
      <main className={styles.page}>
        <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
          <span><Link href="/apps">Store</Link><ChevronRight size={15} /><Link href="/apps#category-messaging">Messaging</Link><ChevronRight size={15} /><strong>WhatsApp Messaging</strong></span>
          <Link href="/apps"><ArrowLeft size={17} />Back to store</Link>
        </nav>

        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <h1>WhatsApp <em>Messaging</em></h1>
            <p>Answer customers, send updates, organize contacts, and follow up from one simple workspace. No technical knowledge is needed.</p>
            <div className={styles.heroActions}>
              {action.disabled ? <button type="button" disabled title={needsConnection ? setupInstruction : undefined}>{action.label}</button> : <Link href={action.href}>{action.label}<ArrowRight size={19} /></Link>}
              {needsConnection ? <Link href={service.configHref}>{setupLabel}<ChevronRight size={18} /></Link> : <a href="#capabilities">See how it helps<ChevronRight size={18} /></a>}
            </div>
            {needsConnection && (
              <p className={styles.setupNote} role="status">
                <CircleAlert size={17} strokeWidth={2} aria-hidden="true" />
                <span>{setupInstruction}</span>
              </p>
            )}
            <div className={styles.heroAssurances}><span><BadgeCheck size={18} strokeWidth={1.9} />Simple setup</span><span><ShieldCheck size={18} strokeWidth={1.9} />Works with Meta or WATI</span><span><UsersRound size={18} strokeWidth={1.9} />Easy for your team</span></div>
          </div>
          <HeroProductDemo />
        </section>

        <ServiceOverview />

        <AudienceGuide />

        <ConnectionSection
          configHref={service.configHref}
          ctaLabel={needsConnection ? setupLabel : "Manage WhatsApp connection"}
        />

        <SecuritySection />

        <section className={styles.launchSection}>
          <div>
            <h2>{connected ? "Continue where your WhatsApp work happens." : "Bring WhatsApp into a workspace your whole team can understand."}</h2>
            {needsConnection && <p>{setupInstruction}</p>}
          </div>
          {needsConnection ? <Link href={service.configHref}>{setupLabel}<ArrowRight size={19} /></Link> : action.disabled ? <button type="button" disabled>{action.label}</button> : <Link href={action.href}>{action.label}<ArrowRight size={19} /></Link>}
        </section>
      </main>
    </ProductShell>
  );
}
