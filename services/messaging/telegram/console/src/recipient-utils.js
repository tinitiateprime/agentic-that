export function recipientFromGroupLine(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const username = text.match(/@[A-Za-z0-9_]{5,}/);
  if (username) return username[0];
  const phone = text.match(/\+\d[\d\s().-]{6,}\d/);
  if (phone) return phone[0].replace(/[^\d+]/g, "");
  if (/^[A-Za-z][A-Za-z0-9_]{4,}$/.test(text)) return `@${text}`;
  const digits = text.replace(/\D/g, "");
  if (/^\d{10}$/.test(digits)) return `+91${digits}`;
  if (text.startsWith("+") && /^\d{8,15}$/.test(digits)) return `+${digits}`;
  return text;
}

export function normalizeContactPhone(rawPhone, countryCode = "+91", allowedCountryCodes = []) {
  const text = String(rawPhone || "").trim();
  const digits = text.replace(/\D/g, "");
  if (!digits) return "";
  if (text.startsWith("+")) return `+${digits}`;
  const allowed = Array.isArray(allowedCountryCodes) ? allowedCountryCodes : [];
  const code = allowed.length && !allowed.includes(countryCode) ? "+91" : /^\+\d+$/.test(countryCode) ? countryCode : "+91";
  const countryDigits = code.replace(/\D/g, "");
  return digits.startsWith(countryDigits) && digits.length > countryDigits.length + 6 ? `+${digits}` : `${code}${digits}`;
}

export function savedContactRecipient(contact, allowedCountryCodes = []) {
  // A saved phone identifies the intended Telegram account more reliably than
  // a manually typed label/username. Only use the username as a fallback.
  const phone = normalizeContactPhone(contact?.phone, contact?.countryCode || "+91", allowedCountryCodes);
  if (phone) return phone;
  return recipientFromGroupLine(contact?.handle || "");
}
