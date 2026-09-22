import postgres from "postgres";

const globalForWebsiteStudio = globalThis;

function connectionString() {
  const value = String(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "").trim();
  if (!value) throw new Error("DATABASE_URL is required for AI Website Studio.");
  if (value.includes("...") || /\[YOUR-PASSWORD\]/i.test(value)) {
    throw new Error("DATABASE_URL contains a placeholder instead of a production database connection.");
  }
  return value;
}

const timestampAsIso = {
  to: 1184,
  from: [1082, 1083, 1114, 1184],
  serialize: (value) => (value instanceof Date ? value.toISOString() : value),
  parse: (value) => {
    let normalized = String(value).replace(" ", "T");
    if (/[+-]\d{2}$/.test(normalized)) normalized += ":00";
    else if (!/([+-]\d{2}:?\d{2}|Z)$/.test(normalized)) normalized += "Z";
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
  },
};

export async function getWebsiteStudioSql() {
  globalForWebsiteStudio.__websiteStudioSql ||= postgres(connectionString(), {
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 15,
    onnotice: () => {},
    types: { timestamp: timestampAsIso },
  });
  return globalForWebsiteStudio.__websiteStudioSql;
}
