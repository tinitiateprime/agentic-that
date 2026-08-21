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
  const columns = await sql`
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'messages'
       AND column_name IN ('reaction', 'reaction_at')`;
  const names = new Set(columns.map((row) => row.column_name));
  if (!names.has("reaction") || !names.has("reaction_at")) {
    throw new Error("The WhatsApp migration did not create the reaction columns.");
  }
  process.stdout.write("WhatsApp database migration is ready.\n");
} finally {
  await sql.end();
}
