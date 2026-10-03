import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

if (!process.env.DATABASE_URL?.trim() && !process.env.SUPABASE_DB_URL?.trim()) {
  throw new Error("DATABASE_URL or SUPABASE_DB_URL is required for the WhatsApp migration.");
}

process.env.RUN_DATABASE_MIGRATIONS = "true";
const { migrateWhatsAppSchema } = await import("../services/messaging/whatsapp/src/lib/db.js");
const sql = await migrateWhatsAppSchema();

try {
  const expected = {
    messages: ["reaction", "reaction_at"],
    businesses: ["welcome_enabled", "welcome_template_name", "welcome_template_language",
                 "welcome_template_params", "welcome_template_body"],
    contacts: ["welcome_sent_at"],
    whatsapp_accounts: ["app_subscribed"],
  };
  const columns = await sql`
    SELECT table_name, column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN ${sql(Object.keys(expected))}`;
  const present = new Set(columns.map((row) => `${row.table_name}.${row.column_name}`));
  const missing = Object.entries(expected)
    .flatMap(([table, names]) => names.map((name) => `${table}.${name}`))
    .filter((column) => !present.has(column));
  if (missing.length) {
    throw new Error(`The WhatsApp migration did not create: ${missing.join(", ")}.`);
  }
  process.stdout.write("WhatsApp database migration is ready.\n");
} finally {
  await sql.end();
}
