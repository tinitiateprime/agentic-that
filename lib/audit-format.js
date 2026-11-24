// Shape of the audit columns that agentic_that.audit_stamp() keeps on every
// table (supabase/migrations/202611250001_audit_columns.sql), for the UI.
// Works on both raw rows (snake_case) and already-mapped objects.

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function auditFromRow(row) {
  if (!row) return null;
  if (row.audit && typeof row.audit === "object") return row.audit;
  const audit = {
    createdBy: row.created_by_username || null,
    createdAt: iso(row.created_datetime),
    updatedBy: row.updated_by_username || null,
    updatedAt: iso(row.updated_datetime),
  };
  return audit.createdBy || audit.createdAt || audit.updatedBy || audit.updatedAt ? audit : null;
}

// True when the row was changed after it was created (by anyone, or later).
export function auditWasUpdated(audit) {
  if (!audit?.updatedAt) return false;
  if (!audit.createdAt) return true;
  return new Date(audit.updatedAt).getTime() - new Date(audit.createdAt).getTime() > 1000
    || (audit.updatedBy && audit.updatedBy !== audit.createdBy);
}
