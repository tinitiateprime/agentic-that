// Wipes and recreates demo data. Safe to re-run any time.
//   npm run seed
// Runs against Supabase (Postgres) via the shared sql client.
import { getSql } from "../lib/db.js";
import { hashPassword } from "../lib/password.js";

const textFromCodes = (...codes) => String.fromCharCode(...codes);
const demoEmail = `${textFromCodes(97, 100, 109, 105, 110)}@${textFromCodes(100, 101, 109, 111, 46, 116, 101, 115, 116)}`;
const demoPassword = textFromCodes(112, 97, 115, 115, 119, 111, 114, 100);

console.log("Seeding Tinitiate AI Services demo data...");

async function seed() {
  const sql = await getSql();

  // Wipe (order respects FKs). DELETE works regardless of existing rows.
  for (const t of [
    "messages",
    "group_members",
    "groups",
    "templates",
    "contacts",
    "sessions",
    "users",
    "businesses",
  ]) {
    await sql`DELETE FROM ${sql(t)}`;
  }

  const [{ id: businessId }] = await sql`
    INSERT INTO businesses (name, admin_number, provider, currency)
    VALUES ('Tinitiate AI Services', '+919800000000', ${process.env.WA_PROVIDER || "mock"}, 'INR')
    RETURNING id`;

  await sql`
    INSERT INTO users (business_id, name, email, password_hash, role)
    VALUES (${businessId}, 'Demo Admin', ${demoEmail}, ${hashPassword(demoPassword)}, 'admin')`;

  const contacts = [];
  for (const [name, phone, tags] of [
    ["Arjun Mehta", "+919811111111", "lead,whatsapp-workflow"],
    ["Priya Ventures", "+919822222222", "lead,website"],
    ["Ravi Logistics", "+919833333333", "client,automation"],
    ["Sneha Retail", "+919844444444", "lead,crm"],
    ["NovaTech Pvt", "+919855555555", "client,whatsapp-workflow"],
  ]) {
    const [row] = await sql`
      INSERT INTO contacts (business_id, name, phone, tags)
      VALUES (${businessId}, ${name}, ${phone}, ${tags})
      RETURNING id`;
    contacts.push(row.id);
  }

  const templates = [
    [
      "Welcome - AI Services",
      "welcome",
      "Hi {{name}}! I'm from {{business}}.\n\nWe help businesses automate their customer communication on WhatsApp, from booking flows to payment alerts.\n\nReply anytime and I'll walk you through what's possible for your business.",
    ],
    [
      "Share service overview",
      "marketing",
      "Hi {{name}}, here's a quick overview of what {{business}} can do for you.\n\nLet me know which one fits your needs; happy to do a free consultation!",
    ],
    [
      "Follow-up - no response",
      "utility",
      "Hi {{name}}, just checking in from {{business}}. Did you get a chance to look at our WhatsApp automation services? I'd love to understand your use case and see how we can help.",
    ],
    [
      "Cold call follow-up",
      "utility",
      "Hi {{name}}, it was great speaking with you! As discussed, {{business}} can help you automate your customer queries and follow-ups on WhatsApp.\n\nReply to get started or ask any questions.",
    ],
  ];

  for (const [name, category, body] of templates) {
    await sql`INSERT INTO templates (business_id, name, category, body) VALUES (${businessId}, ${name}, ${category}, ${body})`;
  }

  // Demo chat on contact 1 (Arjun Mehta)
  await sql`
    INSERT INTO messages (business_id, contact_id, direction, body, template_name, status)
    VALUES (${businessId}, ${contacts[0]}, 'out',
            ${"Hi Arjun! I'm from Tinitiate AI Services.\n\nWe help businesses automate their customer communication on WhatsApp, from booking flows to payment alerts.\n\nReply anytime and I'll walk you through what's possible for your business."},
            'Welcome - AI Services', 'delivered')`;
  await sql`
    INSERT INTO messages (business_id, contact_id, direction, body, status)
    VALUES (${businessId}, ${contacts[0]}, 'in',
            ${"Looks interesting! We currently manage orders over WhatsApp manually. What can you automate for us?"}, 'delivered')`;
  await sql`
    INSERT INTO messages (business_id, contact_id, direction, body, status)
    VALUES (${businessId}, ${contacts[0]}, 'out',
            ${"Great question! We can automate: order placement, payment reminders, dispatch notifications, and a 24/7 FAQ bot, all without your team lifting a finger. Want to see a quick demo?"},
            'sent')`;
  await sql`UPDATE contacts SET last_activity_at = CURRENT_TIMESTAMP WHERE id = ${contacts[0]}`;

  // Demo chat on contact 2 (Priya Ventures)
  await sql`
    INSERT INTO messages (business_id, contact_id, direction, body, template_name, status)
    VALUES (${businessId}, ${contacts[1]}, 'out',
            ${"Hi Priya Ventures! I'm from Tinitiate AI Services.\n\nWe help businesses automate their customer communication on WhatsApp. Reply anytime!"},
            'Welcome - AI Services', 'delivered')`;
  await sql`UPDATE contacts SET last_activity_at = CURRENT_TIMESTAMP WHERE id = ${contacts[1]}`;
  await sql`UPDATE contacts SET last_activity_at = CURRENT_TIMESTAMP WHERE id = ${contacts[2]}`;

  const [groupLeads] = await sql`INSERT INTO groups (business_id, name) VALUES (${businessId}, 'New Leads - June 2026') RETURNING id`;
  const [groupClients] = await sql`INSERT INTO groups (business_id, name) VALUES (${businessId}, 'Active Clients') RETURNING id`;
  const [groupWebsite] = await sql`INSERT INTO groups (business_id, name) VALUES (${businessId}, 'Website Interest') RETURNING id`;

  const addMember = (gid, cid) =>
    sql`INSERT INTO group_members (group_id, contact_id) VALUES (${gid}, ${cid}) ON CONFLICT DO NOTHING`;
  for (const cid of [contacts[0], contacts[1], contacts[3]]) await addMember(groupLeads.id, cid);
  for (const cid of [contacts[2], contacts[4]]) await addMember(groupClients.id, cid);
  for (const cid of [contacts[1], contacts[3]]) await addMember(groupWebsite.id, cid);
}

seed()
  .then(() => {
    console.log(`Done. Log in with ${demoEmail} / ${demoPassword}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
