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
  CircleCheck,
  Clock3,
  ContactRound,
  FileCheck2,
  FileText,
  Inbox,
  Link2,
  LockKeyhole,
  Megaphone,
  MessageCircleMore,
  MoreHorizontal,
  Paperclip,
  Search,
  Send,
  ShieldCheck,
  Tags,
  UsersRound,
  Workflow,
  Zap,
} from "lucide-react";
import { useState } from "react";
import ProductShell from "./ProductShell";
import { useProductStatus } from "./use-product-status";
import styles from "./whatsapp-service-detail.module.css";

const workspaceViews = [
  {
    id: "inbox",
    label: "Shared inbox",
    icon: Inbox,
    eyebrow: "One inbox. Complete context.",
    title: "Keep every customer conversation moving",
    description: "Read, assign, and reply without losing the history behind the customer. The team works from one current conversation record.",
  },
  {
    id: "campaigns",
    label: "Campaigns",
    icon: Megaphone,
    eyebrow: "Controlled audience delivery",
    title: "Prepare outreach without juggling spreadsheets",
    description: "Choose an audience, select an approved template, and review the send plan before the campaign enters delivery.",
  },
  {
    id: "templates",
    label: "Templates",
    icon: FileCheck2,
    eyebrow: "Approved messages, ready to use",
    title: "Turn repeat communication into dependable templates",
    description: "Find the right approved message, confirm its language and variables, and preview exactly what the customer will receive.",
  },
  {
    id: "contacts",
    label: "Contacts",
    icon: UsersRound,
    eyebrow: "A useful customer directory",
    title: "Organize people around the work your team does",
    description: "Keep customer details, groups, consent context, and recent activity together so every workflow starts with the right audience.",
  },
  {
    id: "automations",
    label: "Automations",
    icon: Workflow,
    eyebrow: "Repeatable follow-up, kept visible",
    title: "Build clear actions around real conversation events",
    description: "Connect a trigger to a reviewed response and an owner. Every step remains visible, understandable, and easy to pause.",
  },
];

function actionFor(status, service) {
  if (status.state === "checking") return { label: "Checking connection", disabled: true };
  if (status.state === "connected") return { label: "Open WhatsApp workspace", href: service.dashboardHref };
  if (status.state === "continue") return { label: "Continue setup", href: service.configHref };
  return { label: "Connect WhatsApp", href: service.configHref };
}

function Avatar({ tone = "green", children }) {
  return <span className={`${styles.avatar} ${styles[`avatar_${tone}`]}`}>{children}</span>;
}

function InboxPreview() {
  return (
    <div className={styles.inboxPreview}>
      <aside className={styles.conversationList}>
        <div className={styles.previewSearch}><Search size={14} /><span>Search conversations</span></div>
        <div className={`${styles.conversationRow} ${styles.conversationActive}`}>
          <Avatar>MR</Avatar><span><strong>Maya Rao</strong><small>Is my appointment confirmed?</small></span><time>10:24</time>
        </div>
        <div className={styles.conversationRow}>
          <Avatar tone="blue">OU</Avatar><span><strong>Order Updates</strong><small>Thank you! We’ll share the details.</small></span><time>Yesterday</time>
        </div>
        <div className={styles.conversationRow}>
          <Avatar tone="sand">AK</Avatar><span><strong>Arjun Kumar</strong><small>I need help with my order.</small></span><time>Mon</time>
        </div>
      </aside>
      <section className={styles.chatPanel}>
        <header><Avatar>MR</Avatar><span><strong>Maya Rao</strong><small>WhatsApp Business</small></span><MoreHorizontal size={17} /></header>
        <div className={styles.chatMessages}>
          <div className={styles.incomingMessage}>Is my appointment confirmed?<small>10:24 AM</small></div>
          <div className={styles.outgoingMessage}>Yes—your appointment is confirmed for 4:00 PM.<small>10:25 AM <Check size={12} /></small></div>
        </div>
        <div className={styles.previewComposer}><Paperclip size={16} /><span>Connect your account to send messages</span><Send size={16} /></div>
      </section>
    </div>
  );
}

function CampaignPreview() {
  return (
    <div className={styles.campaignPreview}>
      <section className={styles.campaignBuilder}>
        <header><span><small>CAMPAIGN</small><strong>Appointment reminders</strong></span><span className={styles.draftBadge}>Draft</span></header>
        <div className={styles.builderRow}><span className={styles.builderIcon}><UsersRound size={18} /></span><span><small>Audience</small><strong>Upcoming appointments</strong></span><ChevronRight size={17} /></div>
        <div className={styles.builderRow}><span className={styles.builderIcon}><FileCheck2 size={18} /></span><span><small>Template</small><strong>appointment_confirmation</strong></span><BadgeCheck size={17} /></div>
        <div className={styles.builderRow}><span className={styles.builderIcon}><CalendarClock size={18} /></span><span><small>Delivery</small><strong>Tomorrow at 9:00 AM</strong></span><ChevronRight size={17} /></div>
        <div className={styles.campaignReady}><CircleCheck size={17} /><span>Ready for review</span><strong>Review campaign <ArrowRight size={15} /></strong></div>
      </section>
      <aside className={styles.phonePreview}>
        <div className={styles.phoneHeader}><MessageCircleMore size={16} /><span>Message preview</span></div>
        <div className={styles.phoneMessage}>Hi Maya, your appointment is confirmed for tomorrow at 4:00 PM. Reply HELP if you need assistance.<small>Approved template</small></div>
      </aside>
    </div>
  );
}

function TemplatesPreview() {
  const templates = [
    ["appointment_confirmation", "Approved", "green"],
    ["order_ready", "Approved", "green"],
    ["payment_follow_up", "In review", "amber"],
  ];
  return (
    <div className={styles.templatesPreview}>
      <aside className={styles.templateList}>
        <header><strong>Message templates</strong><span><Search size={15} /></span></header>
        {templates.map(([name, status, tone], index) => (
          <div className={`${styles.templateRow} ${index === 0 ? styles.templateActive : ""}`} key={name}>
            <FileText size={17} /><span><strong>{name}</strong><small>English · Utility</small></span><em className={styles[`template_${tone}`]}>{status}</em>
          </div>
        ))}
      </aside>
      <section className={styles.templateDetail}>
        <header><span><small>APPROVED TEMPLATE</small><strong>Appointment confirmation</strong></span><BadgeCheck size={20} /></header>
        <div className={styles.templateCanvas}>
          <div className={styles.templateBubble}>Hi {"{{1}}"}, your appointment is confirmed for {"{{2}}"}. Reply HELP if you need assistance.</div>
          <div className={styles.variableRail}><Tags size={16} /><span><small>{"{{1}}"}</small> Customer name</span><span><small>{"{{2}}"}</small> Appointment time</span></div>
        </div>
      </section>
    </div>
  );
}

function ContactsPreview() {
  const contacts = [
    ["Maya Rao", "+91 98765 43210", "Appointments", "Today", "MR", "green"],
    ["Arjun Kumar", "+91 98450 12210", "Customers", "Yesterday", "AK", "sand"],
    ["Priya Shah", "+91 98100 44621", "Follow-up", "Mon", "PS", "blue"],
  ];
  return (
    <div className={styles.contactsPreview}>
      <header><span><small>CONTACTS</small><strong>Customer directory</strong></span><div className={styles.contactTools}><span><Search size={15} />Search</span><span className={styles.contactAdd}><ContactRound size={15} />Add contact</span></div></header>
      <div className={styles.contactTable}>
        <div className={styles.contactHead}><span>Customer</span><span>Group</span><span>Last activity</span><span>Status</span></div>
        {contacts.map(([name, phone, group, activity, initials, tone]) => (
          <div className={styles.contactRow} key={phone}>
            <span><Avatar tone={tone}>{initials}</Avatar><span><strong>{name}</strong><small>{phone}</small></span></span>
            <span><Tags size={14} />{group}</span><span>{activity}</span><span><i />Ready</span>
          </div>
        ))}
      </div>
      <footer><UsersRound size={16} /><span>Groups stay reusable across inbox and campaign workflows.</span></footer>
    </div>
  );
}

function AutomationsPreview() {
  return (
    <div className={styles.automationPreview}>
      <header><span><small>AUTOMATION</small><strong>New enquiry follow-up</strong></span><span className={styles.activeBadge}><i />Active</span></header>
      <div className={styles.flowCanvas}>
        <div className={`${styles.flowNode} ${styles.flowTrigger}`}><span><MessageCircleMore size={20} /></span><div><small>WHEN</small><strong>New message received</strong><p>Any WhatsApp conversation</p></div></div>
        <ArrowRight className={styles.flowArrow} size={22} />
        <div className={styles.flowNode}><span><Bot size={20} /></span><div><small>THEN</small><strong>Send quick reply</strong><p>Welcome and response-time note</p></div></div>
        <ArrowRight className={styles.flowArrow} size={22} />
        <div className={styles.flowNode}><span><ContactRound size={20} /></span><div><small>ASSIGN</small><strong>Customer care</strong><p>Keep ownership visible</p></div></div>
      </div>
      <footer><Clock3 size={16} /><span>Runs during business hours</span><ShieldCheck size={16} /><span>Can be paused at any time</span></footer>
    </div>
  );
}

function WorkspacePreview({ activeView }) {
  const viewMap = {
    inbox: <InboxPreview />,
    campaigns: <CampaignPreview />,
    templates: <TemplatesPreview />,
    contacts: <ContactsPreview />,
    automations: <AutomationsPreview />,
  };
  return (
    <div className={styles.previewWindow}>
      <div className={styles.previewTopbar}>
        <span className={styles.previewBrand}><i>AT</i><strong>WhatsApp workspace</strong></span>
        <span className={styles.previewMode}><LockKeyhole size={13} />Interactive preview</span>
      </div>
      <div className={styles.previewShell}>
        <nav className={styles.previewRail} aria-label="Preview workspace sections">
          {workspaceViews.map((item) => {
            const Icon = item.icon;
            return <span className={item.id === activeView ? styles.previewRailActive : ""} title={item.label} key={item.id}><Icon size={18} /></span>;
          })}
        </nav>
        <div className={styles.previewCanvas}>{viewMap[activeView]}</div>
      </div>
    </div>
  );
}

function ConnectionMap({ connected }) {
  const unlocked = [Inbox, Megaphone, FileCheck2, UsersRound, Workflow];
  return (
    <aside className={styles.connectionMap} aria-label="WhatsApp connection overview">
      <header><span>ONE SECURE CONNECTION</span><h2>WhatsApp in. Your workspace ready.</h2></header>
      <div className={styles.connectionBridge}>
        <div className={styles.connectionNode}><img src="/whatsapp-logo.svg" alt="" /><span><strong>WhatsApp</strong><small>Business account</small></span></div>
        <div className={styles.secureLink}><i /><span><LockKeyhole size={16} />Encrypted link</span><i /></div>
        <div className={styles.connectionNode}><b>AT</b><span><strong>AgenticThat</strong><small>Messaging workspace</small></span></div>
      </div>
      <div className={styles.unlockDock}>
        {unlocked.map((Icon, index) => <span key={index}><Icon size={19} /></span>)}
        <small>Inbox, outreach, templates, contacts and follow-ups—kept together.</small>
      </div>
      <footer><span className={connected ? styles.connectionReady : ""}><i />{connected ? "Connection ready" : "Ready when you connect"}</span><ShieldCheck size={17} /></footer>
    </aside>
  );
}

export default function WhatsAppServiceDetail({ user, service, category }) {
  const [activeView, setActiveView] = useState("inbox");
  const { statusFor } = useProductStatus();
  const status = statusFor(service);
  const action = actionFor(status, service);
  const activeItem = workspaceViews.find((item) => item.id === activeView) || workspaceViews[0];
  const ActiveIcon = activeItem.icon;
  const connected = status.state === "connected";

  return (
    <ProductShell user={user} active="apps">
      <main className={styles.page}>
        <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
          <span><Link href="/apps">Store</Link><ChevronRight size={14} /><Link href="/apps#category-messaging">Messaging</Link><ChevronRight size={14} /><strong>WhatsApp Messaging</strong></span>
          <Link href="/apps"><ArrowLeft size={16} />Back to store</Link>
        </nav>

        <section className={styles.hero} id="overview">
          <div className={styles.heroCopy}>
            <div className={styles.heroIdentity}><img src={service.logo} alt="WhatsApp" /><span><small>MESSAGING</small><strong>AgenticThat for WhatsApp</strong></span></div>
            <div className={styles.heroTitleRow}><h1>WhatsApp Messaging</h1><span className={`${styles.heroStatus} ${connected ? styles.heroStatusReady : ""}`}><i />{status.label}</span></div>
            <p>Manage customer conversations, campaigns, templates, contacts, and follow-ups from one secure workspace.</p>
            <div className={styles.heroActions}>
              {action.disabled ? <button type="button" disabled>{action.label}</button> : <Link href={action.href}>{action.label}<ArrowRight size={18} /></Link>}
              <a href="#workspace-tour">Explore the workspace<ChevronRight size={17} /></a>
            </div>
            <div className={styles.heroTrust}><span><MessageCircleMore size={16} />WhatsApp Business</span><span><ShieldCheck size={16} />Secure connection</span><span><Clock3 size={16} />Guided setup</span></div>
          </div>
          <ConnectionMap connected={connected} />
        </section>

        <nav className={styles.sectionNav} aria-label="Service page sections">
          <a href="#overview">Overview</a><a href="#workspace-tour">Workspace tour</a><a href="#connection-flow">How it works</a><a href="#security">Security</a>
        </nav>

        <section className={styles.workspaceTour} id="workspace-tour">
          <header className={styles.sectionHeader}>
            <span>INTERACTIVE WORKSPACE TOUR</span>
            <h2>See the work before you connect</h2>
            <p>Choose an area to see how AgenticThat turns WhatsApp activity into a clear, usable workspace.</p>
          </header>

          <div className={styles.tourTabs} role="tablist" aria-label="WhatsApp workspace previews">
            {workspaceViews.map((item) => {
              const Icon = item.icon;
              const selected = activeView === item.id;
              return (
                <button
                  className={selected ? styles.tourTabActive : ""}
                  id={`tour-tab-${item.id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="workspace-tour-panel"
                  onClick={() => setActiveView(item.id)}
                  key={item.id}
                >
                  <Icon size={19} /><span>{item.label}</span>
                </button>
              );
            })}
          </div>

          <div className={styles.tourStage} id="workspace-tour-panel" role="tabpanel" aria-labelledby={`tour-tab-${activeView}`}>
            <div className={styles.tourNarrative}>
              <span className={styles.tourNarrativeIcon}><ActiveIcon size={24} /></span>
              <small>{activeItem.eyebrow}</small>
              <h3>{activeItem.title}</h3>
              <p>{activeItem.description}</p>
              <div className={styles.tourContext}><Link2 size={17} /><span>The same connected account powers every workspace shown here.</span></div>
            </div>
            <WorkspacePreview activeView={activeView} />
          </div>
        </section>

        <section className={styles.connectionFlow} id="connection-flow">
          <header><span>FROM CONNECTION TO DAILY WORK</span><h2>One clear path into every WhatsApp workflow</h2></header>
          <div className={styles.flowTrack}>
            <article><span><Link2 size={21} /></span><div><small>CONNECT</small><strong>Link the business account you manage</strong></div></article>
            <ArrowRight size={20} />
            <article><span><BadgeCheck size={21} /></span><div><small>CONFIRM</small><strong>Choose the sender and bring in contacts</strong></div></article>
            <ArrowRight size={20} />
            <article><span><Zap size={21} /></span><div><small>WORK</small><strong>Open the exact workspace you need</strong></div></article>
          </div>
        </section>

        <section className={styles.securitySection} id="security">
          <ShieldCheck size={30} />
          <div><span>SECURITY BY DEFAULT</span><h2>Your connection stays protected behind the work.</h2><p>{service.note}</p></div>
          <div className={styles.securitySeal}><LockKeyhole size={18} /><span><strong>Encrypted credentials</strong><small>Never displayed back in the browser</small></span></div>
        </section>

        <section className={styles.launchSection}>
          <div><span>{connected ? "YOUR WORKSPACE IS READY" : "READY TO START"}</span><h2>{connected ? "Continue where your WhatsApp work happens." : "Connect once, then choose the work you want to do."}</h2></div>
          {action.disabled ? <button type="button" disabled>{action.label}</button> : <Link href={action.href}>{action.label}<ArrowRight size={18} /></Link>}
        </section>
      </main>
    </ProductShell>
  );
}
