"use client";

import { Bot, PencilLine, UserPlus } from "lucide-react";
import { auditFromRow, auditWasUpdated } from "../../lib/audit-format.js";

// Who created / last updated a record, and when. Reads the audit columns kept
// on every table (created_by_username, created_datetime, updated_by_username,
// updated_datetime). Inline styles so it renders the same in the Tailwind
// (WhatsApp) and CSS-module (platform) parts of the app.
//
//   <AuditStamp record={row} />                       compact one-liner for lists
//   <AuditStamp record={row} variant="detail" />      two labelled rows for a record view
//   superAdmins={["admin@company.com"]}               marks Super Admin usernames

const muted = "var(--audit-muted, #64748b)";

function formatWhen(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Rows that existed before audit tracking have no recorded user.
function Actor({ username, superAdmins }) {
  if (!username) return <span style={{ color: muted }} title="Made before change tracking was turned on">Not recorded</span>;
  if (username === "system") {
    return (
      <span title="Recorded by a webhook, sync or background job" style={{ whiteSpace: "nowrap" }}>
        <Bot size={12} aria-hidden="true" style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 3 }} />System
      </span>
    );
  }
  const isSuperAdmin = superAdmins?.includes?.(username);
  // Plain inline text so long emails wrap naturally on narrow screens.
  return (
    <span style={{ overflowWrap: "anywhere" }} title={username}>
      {username}
      {isSuperAdmin && (
        <span
          style={{
            display: "inline-block",
            marginLeft: 5,
            fontSize: 10,
            lineHeight: "14px",
            padding: "0 5px",
            borderRadius: 4,
            background: "#eeedfe",
            color: "#3c3489",
            whiteSpace: "nowrap",
            verticalAlign: "1px",
          }}
        >
          Super Admin
        </span>
      )}
    </span>
  );
}

function When({ value }) {
  if (!value) return null;
  return (
    <time dateTime={value} title={new Date(value).toString()} style={{ whiteSpace: "nowrap" }} suppressHydrationWarning>
      {formatWhen(value)}
    </time>
  );
}

export default function AuditStamp({ record, audit: auditProp, variant = "inline", superAdmins, style, className }) {
  const audit = auditProp || auditFromRow(record);
  if (!audit) return null;
  const updated = auditWasUpdated(audit);

  if (variant === "detail") {
    const row = { display: "contents" };
    const label = { color: muted, display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" };
    const value = { minWidth: 0 };
    const time = { color: muted, marginLeft: 8, whiteSpace: "nowrap" };
    return (
      <dl
        className={className}
        aria-label="Record history"
        style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "4px 14px", margin: 0, fontSize: 12.5, ...style }}
      >
        <div style={row}>
          <dt style={label}><UserPlus size={14} aria-hidden="true" />Created</dt>
          <dd style={{ ...value, margin: 0 }}>
            <Actor username={audit.createdBy} superAdmins={superAdmins} />
            {audit.createdAt && <> <span style={time}><When value={audit.createdAt} /></span></>}
          </dd>
        </div>
        <div style={row}>
          <dt style={label}><PencilLine size={14} aria-hidden="true" />Last updated</dt>
          <dd style={{ ...value, margin: 0 }}>
            {updated ? (
              <>
                <Actor username={audit.updatedBy} superAdmins={superAdmins} />
                {audit.updatedAt && <> <span style={time}><When value={audit.updatedAt} /></span></>}
              </>
            ) : (
              <span style={{ color: muted }}>Not changed since it was created</span>
            )}
          </dd>
        </div>
      </dl>
    );
  }

  return (
    <p className={className} style={{ margin: 0, fontSize: 11, lineHeight: "16px", color: muted, minWidth: 0, ...style }}>
      {audit.createdBy ? <>Created by <Actor username={audit.createdBy} superAdmins={superAdmins} /></> : "Created"}
      {audit.createdAt && <>{" · "}<When value={audit.createdAt} /></>}
      {updated && (
        <>
          {audit.updatedBy ? <>{" · Updated by "}<Actor username={audit.updatedBy} superAdmins={superAdmins} /></> : " · Updated"}
          {audit.updatedAt && <>{" · "}<When value={audit.updatedAt} /></>}
        </>
      )}
    </p>
  );
}
