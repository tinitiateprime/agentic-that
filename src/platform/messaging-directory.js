import { normalizeContactPhone, recipientFromGroupLine } from "../../services/messaging/telegram/console/src/recipient-utils.js";

// Merges the WhatsApp and Telegram address books into one list of people.
// A person is identified by name (case-insensitive); a matching phone number
// also joins entries, so "Nik" on WhatsApp and "Nikhil" on Telegram with the
// same number are still one person. Anyone present on only one service is
// kept as a single-service entry and labelled as such.

const digits = (value) => String(value || "").replace(/\D/g, "");
const isNumberLike = (name) => /^\+?[\d\s().-]{6,}$/.test(String(name || "").trim());

export function telegramRecipient(contact) {
  const handle = recipientFromGroupLine(contact?.handle || "");
  if (handle.startsWith("@")) return handle;
  const phone = normalizeContactPhone(contact?.phone, contact?.countryCode || "+91");
  return phone || handle;
}

function telegramPhoneDigits(contact) {
  return digits(normalizeContactPhone(contact?.phone, contact?.countryCode || "+91"));
}

function keysFor(name, phoneDigits) {
  const keys = [];
  const lowered = String(name || "").trim().toLowerCase();
  if (lowered && !isNumberLike(lowered)) keys.push(`n:${lowered}`);
  if (phoneDigits) keys.push(`p:${phoneDigits}`);
  return keys;
}

export function buildDirectory(whatsappContacts = [], telegramContacts = []) {
  const people = [];
  const index = new Map();

  function place(slot, record, name, phoneDigits) {
    const keys = keysFor(name, phoneDigits);
    let person = keys.map((key) => index.get(key)).find((found) => found && !found[slot]);
    if (!person) {
      person = { id: `p${people.length}`, name: String(name || "").trim() || "Unnamed", whatsapp: null, telegram: null };
      people.push(person);
    }
    person[slot] = record;
    // A real name beats a bare phone number as the display name.
    if (isNumberLike(person.name) && name && !isNumberLike(name)) person.name = String(name).trim();
    keys.forEach((key) => { if (!index.has(key)) index.set(key, person); });
  }

  whatsappContacts.forEach((contact) => place("whatsapp", contact, contact.name, digits(contact.phone)));
  telegramContacts.forEach((contact) => {
    const recipient = telegramRecipient(contact);
    if (!recipient) return;
    place("telegram", { ...contact, recipient }, contact.name, telegramPhoneDigits(contact));
  });

  return people.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

// "Both" / "WhatsApp only" / "Telegram only" for the badge and the filter.
export function personServices(person) {
  if (person.whatsapp && person.telegram) return "both";
  return person.whatsapp ? "whatsapp" : "telegram";
}

// Groups with the same name on both services show up as one selectable group.
export function buildGroups(whatsappGroups = [], telegramGroups = []) {
  const groups = [];
  const index = new Map();
  const place = (slot, record) => {
    const key = String(record.name || "").trim().toLowerCase() || `__${slot}_${record.id}`;
    let group = index.get(key);
    if (!group || group[slot]) {
      group = { id: `g${groups.length}`, name: String(record.name || "").trim() || "Untitled group", whatsapp: null, telegram: null };
      groups.push(group);
    }
    group[slot] = record;
    if (!index.has(key)) index.set(key, group);
  };
  whatsappGroups.forEach((group) => place("whatsapp", group));
  telegramGroups.forEach((group) => place("telegram", group));
  return groups.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
