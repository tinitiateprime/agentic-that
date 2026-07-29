import { getCurrentUser } from "@whatsapp/lib/auth";
import { getSql } from "@whatsapp/lib/db";
import { importContacts, syncWatiMessages } from "@whatsapp/lib/data";
import {
  normalizeWaNumber,
  watiConfigured,
  watiGetContacts,
  watiGetMessages,
} from "@whatsapp/lib/wa/provider";
import { credsForProvider } from "@whatsapp/lib/tenant";

// Pull WATI history into the CRM. One contact-list request plus at most eight
// getMessages calls keeps a manual sync inside WATI's documented request-rate
// envelope. A later click can sync another selected batch when needed.
export async function POST(req) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const creds = await credsForProvider(user.business_id, "wati");
  if (!watiConfigured(creds)) {
    return Response.json({ error: "WATI isn't configured." }, { status: 400 });
  }

  const { phones, offset: requestedOffset } = await req.json().catch(() => ({}));
  let sourceContacts;
  try {
    sourceContacts = await watiGetContacts({ pageSize: 100 }, creds);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }

  if (Array.isArray(phones) && phones.length) {
    const wanted = new Set(phones.map(normalizeWaNumber));
    sourceContacts = sourceContacts.filter((contact) => wanted.has(normalizeWaNumber(contact.phone)));
  }

  const offset = Math.min(Math.max(Number(requestedOffset) || 0, 0), sourceContacts.length);
  const totalContacts = sourceContacts.length;
  sourceContacts = sourceContacts.slice(offset, offset + 8);
  const nextOffset = offset + sourceContacts.length;
  const remaining = Math.max(totalContacts - nextOffset, 0);
  const contactImport = await importContacts(user.business_id, sourceContacts);
  const sql = await getSql();
  const crmContacts = await sql`
    SELECT id, phone FROM contacts WHERE business_id = ${user.business_id}`;
  const crmByPhone = new Map(
    crmContacts.map((contact) => [normalizeWaNumber(contact.phone), contact])
  );

  let importedMessages = 0;
  let updatedMessages = 0;
  let syncedContacts = 0;
  const errors = [];

  for (const source of sourceContacts) {
    const normalized = normalizeWaNumber(source.phone);
    const contact = crmByPhone.get(normalized);
    if (!contact) continue;
    try {
      const history = await watiGetMessages(source.phone, { pageSize: 100 }, creds);
      const result = await syncWatiMessages(user.business_id, contact.id, history.messages);
      importedMessages += result.imported;
      updatedMessages += result.updated;
      syncedContacts++;
    } catch (err) {
      errors.push({ phone: source.phone, error: err.message });
    }
  }

  const response = {
    ok: errors.length === 0,
    syncedContacts,
    importedMessages,
    updatedMessages,
    importedContacts: contactImport.imported,
    skippedContacts: contactImport.skipped,
    remaining,
    nextOffset: remaining ? nextOffset : 0,
    failedContacts: errors.length,
  };
  if (errors.length && syncedContacts === 0) {
    return Response.json({ ...response, error: errors[0].error }, { status: 502 });
  }
  return Response.json(response);
}
