import { readFileSync, writeFileSync } from "node:fs";

// postgres 3.4.9 only reserves a sql.begin() connection after its pipeline
// checks. With max_pipeline: 0 those checks skip the reservation callback.
// Reserve first so disabling pipelining still preserves transaction ownership.
const before = `      return write(toBuffer(q))
        && !q.describeFirst
        && !q.cursorFn
        && sent.length < max_pipeline
        && (!q.options.onexecute || q.options.onexecute(connection))`;
const after = `      return write(toBuffer(q))
        && (!q.options.onexecute || q.options.onexecute(connection))
        && !q.describeFirst
        && !q.cursorFn
        && sent.length < max_pipeline`;

for (const file of ["src/connection.js", "cjs/src/connection.js"]) {
  const location = new URL(`../node_modules/postgres/${file}`, import.meta.url);
  const source = readFileSync(location, "utf8");
  if (source.includes(after)) continue;
  if (!source.includes(before)) throw new Error(`The postgres transaction reservation patch needs review: ${file}.`);
  writeFileSync(location, source.replace(before, after));
}
console.log("Applied Postgres transaction reservation fix for serialized Supabase queries.");
