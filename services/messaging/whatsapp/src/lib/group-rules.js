import { getSql } from "./db.js";

// Keyword group rules. The matching itself lives in Postgres triggers (see
// supabase/migrations/202609200001_whatsapp_message_group_rules.sql) so every
// inbound write path is covered; this module is only the CRUD around them.

export class GroupRuleError extends Error {}

const MAX_KEYWORDS = 25;

/** Accepts "price, quote" or ["price", "quote"], trimmed and de-duplicated. */
export function normalizeKeywords(input) {
  const list = Array.isArray(input) ? input : String(input || "").split(",");
  const keywords = [...new Set(list.map((keyword) => String(keyword).trim().toLowerCase()).filter(Boolean))];
  if (!keywords.length) throw new GroupRuleError("Add at least one keyword.");
  if (keywords.length > MAX_KEYWORDS) throw new GroupRuleError(`Use at most ${MAX_KEYWORDS} keywords in one rule.`);
  const tooLong = keywords.find((keyword) => keyword.length > 60);
  if (tooLong) throw new GroupRuleError(`The keyword "${tooLong}" is too long.`);
  return keywords;
}

function boundedNumber(value, { field, min, max, fallback }) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new GroupRuleError(`${field} must be a whole number between ${min} and ${max}.`);
  }
  return number;
}

function normalizeName(value) {
  const name = String(value || "").trim();
  if (!name) throw new GroupRuleError("Give the group a name.");
  if (name.length > 80) throw new GroupRuleError("The group name is too long.");
  return name;
}

function duplicateName(error) {
  return /whatsapp_group_rules_name_idx|duplicate key/i.test(String(error?.message));
}

export async function listGroupRules(businessId) {
  const sql = await getSql();
  try {
    return await sql`
      SELECT rule.*,
             CAST(COUNT(member.contact_id) AS INTEGER) AS member_count
        FROM whatsapp_group_rules rule
        LEFT JOIN group_members member ON member.group_id = rule.group_id
       WHERE rule.business_id = ${businessId}
       GROUP BY rule.id
       ORDER BY lower(rule.name)`;
  } catch (error) {
    // The Groups page still renders on a deployment where the rules migration
    // has not been applied yet; the section simply stays empty.
    if (error?.code === "42P01") return [];
    throw error;
  }
}

export async function createGroupRule(businessId, { name, keywords, minOccurrences, windowDays }) {
  const sql = await getSql();
  const values = {
    name: normalizeName(name),
    keywords: normalizeKeywords(keywords),
    minOccurrences: boundedNumber(minOccurrences, { field: "Occurrences", min: 1, max: 100, fallback: 1 }),
    windowDays: boundedNumber(windowDays, { field: "Days", min: 1, max: 365, fallback: 7 }),
  };
  try {
    // The insert trigger backfills recent messages, so the returned row already
    // reflects any contact the rule matched.
    const [created] = await sql`
      INSERT INTO whatsapp_group_rules (business_id, name, keywords, min_occurrences, window_days)
      VALUES (${businessId}, ${values.name}, ${values.keywords}, ${values.minOccurrences}, ${values.windowDays})
      RETURNING id`;
    return getGroupRule(businessId, created.id);
  } catch (error) {
    if (duplicateName(error)) throw new GroupRuleError("A rule with this name already exists.");
    throw error;
  }
}

export async function getGroupRule(businessId, id) {
  const sql = await getSql();
  const [rule] = await sql`
    SELECT rule.*,
           CAST((SELECT COUNT(*) FROM group_members member WHERE member.group_id = rule.group_id) AS INTEGER) AS member_count
      FROM whatsapp_group_rules rule
     WHERE rule.business_id = ${businessId} AND rule.id = ${id}`;
  return rule || null;
}

export async function updateGroupRule(businessId, id, patch) {
  const sql = await getSql();
  const current = await getGroupRule(businessId, id);
  if (!current) throw new GroupRuleError("This rule no longer exists.");
  const next = {
    name: patch.name === undefined ? current.name : normalizeName(patch.name),
    keywords: patch.keywords === undefined ? current.keywords : normalizeKeywords(patch.keywords),
    minOccurrences: patch.minOccurrences === undefined
      ? current.min_occurrences
      : boundedNumber(patch.minOccurrences, { field: "Occurrences", min: 1, max: 100, fallback: current.min_occurrences }),
    windowDays: patch.windowDays === undefined
      ? current.window_days
      : boundedNumber(patch.windowDays, { field: "Days", min: 1, max: 365, fallback: current.window_days }),
    enabled: patch.enabled === undefined ? current.enabled : Boolean(patch.enabled),
  };
  try {
    await sql`
      UPDATE whatsapp_group_rules
         SET name = ${next.name}, keywords = ${next.keywords}, min_occurrences = ${next.minOccurrences},
             window_days = ${next.windowDays}, enabled = ${next.enabled}, updated_at = now()
       WHERE business_id = ${businessId} AND id = ${id}`;
  } catch (error) {
    if (duplicateName(error)) throw new GroupRuleError("A rule with this name already exists.");
    throw error;
  }
  return getGroupRule(businessId, id);
}

/**
 * Removes the rule. The group it filled stays behind with its members, because
 * deleting a rule should not delete a group someone may be broadcasting to.
 */
export async function deleteGroupRule(businessId, id) {
  const sql = await getSql();
  const result = await sql`
    DELETE FROM whatsapp_group_rules WHERE business_id = ${businessId} AND id = ${id}`;
  if (!result.count) throw new GroupRuleError("This rule no longer exists.");
  return true;
}
