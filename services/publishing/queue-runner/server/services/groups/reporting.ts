// Reports Group Manager results to AgenticThat's database as they happen, over
// the Companion's workspace pairing. Changes are gathered for a moment and sent
// together; if sending fails (offline, not paired) they are tried again later,
// and the open Group Manager page also copies them across.

import type { Group } from "./model.js";

export type GroupReport = {
  id: string;
  apps: Group["apps"];
  members: { contactId: string; apps: Group["members"][number]["apps"] }[];
  messages: { id: string; results: Group["messages"][number]["results"] }[];
};

/** Sends reports; resolves false when there is no pairing to send them with. */
export type GroupReporter = (groups: GroupReport[]) => Promise<boolean>;

let reporter: GroupReporter | null = null;
const waiting = new Map<string, GroupReport>();
let timer: NodeJS.Timeout | null = null;
let retryMs = 2000;

/** Set by the Companion server once it can reach AgenticThat with its pairing. */
export function setGroupReporter(next: GroupReporter | null) {
  reporter = next;
  if (next && waiting.size) {
    // A way to report is (newly) available: send soon instead of waiting out a backoff.
    if (timer) clearTimeout(timer);
    timer = null;
    retryMs = 2000;
    schedule(300);
  }
}

export function groupReport(group: Group): GroupReport {
  return {
    id: group.id,
    apps: group.apps,
    members: group.members.map((member) => ({ contactId: member.contactId, apps: member.apps })),
    messages: group.messages.map((message) => ({ id: message.id, results: message.results })),
  };
}

function schedule(ms: number) {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, ms);
  timer.unref?.();
}

async function flush() {
  if (!reporter || !waiting.size) return;
  const batch = [...waiting.values()].slice(0, 50);
  for (const report of batch) waiting.delete(report.id);
  try {
    const sent = await reporter(batch);
    if (!sent) throw new Error("not paired");
    retryMs = 2000;
  } catch {
    // Keep the newest copy of each group and try again, waiting longer each time.
    for (const report of batch) if (!waiting.has(report.id)) waiting.set(report.id, report);
    retryMs = Math.min(retryMs * 2, 5 * 60_000);
    schedule(retryMs);
    return;
  }
  if (waiting.size) schedule(300);
}

/** Queues a group's latest state to be reported. */
export function reportGroup(group: Group) {
  waiting.set(group.id, groupReport(group));
  schedule(400);
}
