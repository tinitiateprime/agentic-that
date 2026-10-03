import nodeCron, { type ScheduledTask } from "node-cron";
import { listDueScheduleIdsWithQueuedUploads, listDueScheduledUploads, listUploads, markSchedulesTriggered } from "../local-storage.js";
import { publishingCompanionId } from "../companion-identity.js";
import { isAutomationRunning, runAutomation } from "./publisher.js";

let schedulerTask: ScheduledTask | null = null;
let schedulerCheckActive = false;

function getSchedulerExpression() {
  return process.env.PUBLISH_QUEUE_SCHEDULER_CRON?.trim()
    || process.env.SCHEDULER_CRON?.trim()
    || "* * * * *";
}

async function checkScheduledUploads() {
  if (schedulerCheckActive || isAutomationRunning()) return;
  schedulerCheckActive = true;

  try {
    const companionId = publishingCompanionId();
    const dueUploads = await listDueScheduledUploads(companionId);
    if (dueUploads.length === 0) return;
    const dueScheduleIds = await listDueScheduleIdsWithQueuedUploads(companionId);

    console.log(
      `Scheduler found ${dueUploads.length} due post(s): ${dueUploads.map((upload) => upload.id).join(", ")}`,
    );
    await runAutomation({
      mode: "scheduledOnly",
      trigger: "scheduler",
      uploadIds: dueUploads.map(upload => upload.id),
    });
    const currentById = new Map((await listUploads()).map(upload => [upload.id, upload]));
    const completedScheduleIds = dueScheduleIds.filter(scheduleId => dueUploads
      .filter(upload => upload.scheduleId === scheduleId)
      .every(upload => {
        const current = currentById.get(upload.id);
        return current?.status === "posted"
          || current?.publishActionState === "submitted"
          || current?.publishActionState === "uncertain"
          || Boolean(current?.safetyDeferredUntil);
      }));
    await markSchedulesTriggered(completedScheduleIds);
  } catch (error) {
    console.error("Scheduled automation check failed:", error);
  } finally {
    schedulerCheckActive = false;
  }
}

export function startScheduler() {
  if (
    schedulerTask
    || (process.env.PUBLISH_QUEUE_SCHEDULER_ENABLED ?? process.env.SCHEDULER_ENABLED) === "false"
  ) return;

  const expression = getSchedulerExpression();
  if (!nodeCron.validate(expression)) throw new Error(`Invalid SCHEDULER_CRON expression: ${expression}`);
  console.log(`Post scheduler active; checking with cron "${expression}".`);
  void checkScheduledUploads();
  schedulerTask = nodeCron.schedule(expression, () => void checkScheduledUploads(), {
    timezone: process.env.PUBLISH_QUEUE_SCHEDULER_TIMEZONE?.trim()
      || process.env.SCHEDULER_TIMEZONE?.trim()
      || undefined,
    name: "post-scheduler",
    noOverlap: true
  });
}

export function stopScheduler() {
  if (!schedulerTask) return;
  schedulerTask.stop();
  schedulerTask.destroy();
  schedulerTask = null;
}
