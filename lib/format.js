// Display helpers — money is stored as integer minor units (cents/paise).
export function formatMoney(cents, currency = "INR") {
  const amount = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function parseMoneyToCents(input) {
  const n = Number(String(input).replace(/[^0-9.]/g, ""));
  return Math.round((Number.isFinite(n) ? n : 0) * 100);
}

// Supabase returns ISO timestamps with a timezone. Add a timezone only when
// one is absent, so a bare "YYYY-MM-DD HH:mm:ss" is still read as UTC.
function parseDate(value) {
  if (value instanceof Date) return value;
  const normalized = String(value).trim().replace(" ", "T");
  const hasTimezone = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(normalized);
  return new Date(hasTimezone ? normalized : `${normalized}Z`);
}

export function timeAgo(iso) {
  if (!iso) return "—";
  const then = parseDate(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

export function formatTime(iso) {
  if (!iso) return "";
  const date = parseDate(iso);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "";
}

// "05:04 PM" — the in-bubble timestamp, WhatsApp style.
export function formatClock(iso) {
  if (!iso) return "";
  const date = parseDate(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// "Jul 7, 05:04 PM" — chat-card header timestamp, WhatsApp style.
export function formatDayClock(iso) {
  if (!iso) return "";
  const date = parseDate(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
