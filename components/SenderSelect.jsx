"use client";

// Sender-number picker shared by Quick send, group broadcast, and Notify.
// Renders nothing unless the WABA has more than one number, so single-number
// deployments are unaffected. value "" = the default number
// (META_PHONE_NUMBER_ID); the parent posts the chosen phoneNumberId.

// "Tinitiate AI …3485" — verified name + last 4 digits of the sender number.
export function phoneShortLabel(n) {
  const digits = String(n.number || "").replace(/\D/g, "");
  const short = `…${digits.slice(-4) || String(n.id).slice(-4)}`;
  return `${n.name || "Business number"} ${short}`;
}

export default function SenderSelect({ phoneNumbers = [], value, onChange, className = "" }) {
  if (phoneNumbers.length < 2) return null;
  const defaultNumber = phoneNumbers.find((n) => n.isDefault);
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
      <span className="font-medium">Send from</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand)] ${className}`}
      >
        <option value="">Default{defaultNumber ? ` — ${phoneShortLabel(defaultNumber)}` : ""}</option>
        {phoneNumbers.map((n) => (
          <option key={n.id} value={n.id}>
            {phoneShortLabel(n)}
          </option>
        ))}
      </select>
    </label>
  );
}
