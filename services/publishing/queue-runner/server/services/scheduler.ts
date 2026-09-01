// Timed publishing is deliberately unavailable in this release. These stable
// lifecycle exports remain so startup/shutdown code and stored legacy records
// stay compatible without creating a cron task or executing timed work.
export function startScheduler() {}

export function stopScheduler() {}
