import { pathToFileURL } from "node:url";
import type { Server } from "node:http";
import { createAutomationApp } from "./app.ts";
import { livePublishingEnabled, loadAutomationConfig } from "./config.ts";
import { assertSafeAutomationDatabase, createAutomationDatabase } from "./database.ts";
import { AutomationJobStore } from "./job-store.ts";
import { PlaywrightLoginBrowserLauncher } from "./login-browser.ts";
import { AutomationLoginManager } from "./login-manager.ts";
import { AutomationLoginStore } from "./login-store.ts";
import { AutomationFileStore } from "./profile-store.ts";
import { automationSchemaReady, migrateAutomationSchema } from "./schema.ts";
import { InstagramPublishingDryRunValidator } from "./instagram-dry-run.ts";
import { PlaywrightInstagramPreviewExecutor } from "./instagram-preview.ts";
import { PlaywrightInstagramPublishingExecutor } from "./instagram-live.ts";
import { FacebookPublishingDryRunValidator } from "./facebook-dry-run.ts";
import { PlaywrightFacebookPublishingExecutor } from "./facebook-live.ts";
import { XPublishingDryRunValidator } from "./x-dry-run.ts";
import { PlaywrightXPublishingExecutor } from "./x-live.ts";
import { LinkedInPublishingDryRunValidator } from "./linkedin-dry-run.ts";
import { PlaywrightLinkedInPublishingExecutor } from "./linkedin-live.ts";
import { YouTubePublishingDryRunValidator } from "./youtube-dry-run.ts";
import { PlaywrightYouTubePublishingExecutor } from "./youtube-live.ts";
import { AutomationPublishingDryRunWorker } from "./publishing-dry-run-worker.ts";
import { AutomationPublishingPreviewWorker } from "./publishing-preview-worker.ts";
import { AutomationPublishingLiveWorkerPool } from "./publishing-live-worker.ts";
import type { PublishingDryRunValidator, ServerPublishingExecutor } from "./executor.ts";

export async function startAutomationServer() {
  const config = loadAutomationConfig();
  const files = new AutomationFileStore(config.dataDirectory, config.mediaUploadMaxBytes);
  await files.initialize();

  assertSafeAutomationDatabase(config);
  const database = createAutomationDatabase(config);
  if (config.autoMigrate) migrateAutomationSchema(database);
  const databaseReady = automationSchemaReady(database);
  const store = databaseReady ? new AutomationJobStore(database, files) : null;
  const loginManager = databaseReady
    ? new AutomationLoginManager(
        new AutomationLoginStore(database),
        files,
        new PlaywrightLoginBrowserLauncher(config.browserExecutablePath, config.loginTimeoutMs),
      )
    : null;
  loginManager?.recoverInterruptedSessions();
  const publishingDryRunWorker = store && config.publishingDryRunEnabled
    ? new AutomationPublishingDryRunWorker(
        store,
        new Map<string, PublishingDryRunValidator>([
          ["instagram", new InstagramPublishingDryRunValidator(files)],
          ["facebook", new FacebookPublishingDryRunValidator(files)],
          ["x", new XPublishingDryRunValidator(files)],
          ["linkedin", new LinkedInPublishingDryRunValidator(files)],
          ["youtube", new YouTubePublishingDryRunValidator(files)],
        ]),
        config.workerPollMs,
      )
    : null;
  const publishingPreviewWorker = store && config.publishingPreviewEnabled
    ? new AutomationPublishingPreviewWorker(
        store,
        files,
        new Map([["instagram", new InstagramPublishingDryRunValidator(files)]]),
        new Map([["instagram", new PlaywrightInstagramPreviewExecutor(files, config.browserExecutablePath)]]),
        config.workerPollMs,
      )
    : null;
  const publishingLiveWorkerPool = store && livePublishingEnabled(config)
    ? new AutomationPublishingLiveWorkerPool(
        store,
        new Map<string, PublishingDryRunValidator>([
          ["instagram", new InstagramPublishingDryRunValidator(files)],
          ["facebook", new FacebookPublishingDryRunValidator(files)],
          ["x", new XPublishingDryRunValidator(files)],
          ["linkedin", new LinkedInPublishingDryRunValidator(files)],
          ["youtube", new YouTubePublishingDryRunValidator(files)],
        ]),
        new Map<string, ServerPublishingExecutor>([
          ...(config.instagramPublishingEnabled ? [["instagram", new PlaywrightInstagramPublishingExecutor(files, config.browserExecutablePath)] as const] : []),
          ...(config.facebookPublishingEnabled ? [["facebook", new PlaywrightFacebookPublishingExecutor(files, config.browserExecutablePath)] as const] : []),
          ...(config.xPublishingEnabled ? [["x", new PlaywrightXPublishingExecutor(files, config.browserExecutablePath)] as const] : []),
          ...(config.linkedinPublishingEnabled ? [["linkedin", new PlaywrightLinkedInPublishingExecutor(files, config.browserExecutablePath)] as const] : []),
          ...(config.youtubePublishingEnabled ? [["youtube", new PlaywrightYouTubePublishingExecutor(files, config.browserExecutablePath)] as const] : []),
        ]),
        config.workerPollMs,
        config.liveWorkerCount,
      )
    : null;

  const app = createAutomationApp({ config, databaseReady, store, loginManager, files });
  const server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(config.port, config.host, () => resolve(listener));
    listener.once("error", reject);
  });
  publishingDryRunWorker?.start();
  publishingPreviewWorker?.start();
  publishingLiveWorkerPool?.start();

  const shutdown = async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await publishingDryRunWorker?.stop();
    await publishingPreviewWorker?.stop();
    await publishingLiveWorkerPool?.stop();
    await loginManager?.shutdown();
    database.close();
  };

  process.stdout.write(
    `AgenticThat automation server listening on http://${config.host}:${config.port} ` +
      `(publishing ${livePublishingEnabled(config) ? `enabled with ${config.liveWorkerCount} worker${config.liveWorkerCount === 1 ? "" : "s"}` : "disabled"}, database ${databaseReady ? "ready" : "not ready"}).\n`,
  );
  return { server, config, shutdown };
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryPoint) {
  startAutomationServer()
    .then(({ shutdown }) => {
      let closing = false;
      const close = () => {
        if (closing) return;
        closing = true;
        void shutdown().finally(() => { process.exitCode = 0; });
      };
      process.once("SIGINT", close);
      process.once("SIGTERM", close);
    })
    .catch(error => {
      process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
