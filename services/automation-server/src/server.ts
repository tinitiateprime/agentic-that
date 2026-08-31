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
import { AzureAutomationRemoteStorage } from "./remote-storage.ts";
import {
  automationPostgresReady,
  closeAutomationPostgres,
  createAutomationPostgres,
  migrateAutomationPostgres,
  type AutomationPostgres,
} from "./postgres-database.ts";
import { PostgresAutomationJobStore } from "./postgres-job-store.ts";
import { PostgresAutomationLoginStore } from "./postgres-login-store.ts";
import type { AutomationJobStoreContract, AutomationLoginStoreContract } from "./store-contracts.ts";
import type { AutomationDatabase } from "./database.ts";
import {
  AutomationScrapingWorker,
  FacebookServerScrapingExecutor,
  InstagramServerScrapingExecutor,
  type ServerScrapingExecutor,
} from "./scraping-worker.ts";
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
  const remoteStorage = config.storageBackend === "azure"
    ? AzureAutomationRemoteStorage.fromConfig(config, config.dataDirectory)
    : undefined;
  const files = new AutomationFileStore(config.dataDirectory, config.mediaUploadMaxBytes, remoteStorage);
  await files.initialize();
  await remoteStorage?.assertReady();

  let sqlite: AutomationDatabase | null = null;
  let postgres: AutomationPostgres | null = null;
  let store: AutomationJobStoreContract | null = null;
  let loginStore: AutomationLoginStoreContract | null = null;
  let databaseReady = false;
  if (config.databaseEngine === "postgres") {
    postgres = createAutomationPostgres(config);
    if (config.autoMigrate) await migrateAutomationPostgres(postgres);
    databaseReady = await automationPostgresReady(postgres);
    if (databaseReady) {
      store = new PostgresAutomationJobStore(postgres, files);
      loginStore = new PostgresAutomationLoginStore(postgres);
    }
  } else {
    assertSafeAutomationDatabase(config);
    sqlite = createAutomationDatabase(config);
    if (config.autoMigrate) migrateAutomationSchema(sqlite);
    databaseReady = automationSchemaReady(sqlite);
    if (databaseReady) {
      store = new AutomationJobStore(sqlite, files);
      loginStore = new AutomationLoginStore(sqlite);
    }
  }
  const loginManager = databaseReady
    ? new AutomationLoginManager(
        loginStore!,
        files,
        new PlaywrightLoginBrowserLauncher(config.browserExecutablePath, config.loginTimeoutMs),
        config.loginMaxConcurrent,
      )
    : null;
  await loginManager?.recoverInterruptedSessions();
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
        undefined,
        files,
        config.jobTimeoutMs,
        config.shutdownGraceMs,
      )
    : null;
  const publishingPreviewWorker = store && config.publishingPreviewEnabled
    ? new AutomationPublishingPreviewWorker(
        store,
        files,
        new Map([["instagram", new InstagramPublishingDryRunValidator(files)]]),
        new Map([["instagram", new PlaywrightInstagramPreviewExecutor(files, config.browserExecutablePath)]]),
        config.workerPollMs,
        undefined,
        config.jobTimeoutMs,
        config.shutdownGraceMs,
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
        files,
        config.jobTimeoutMs,
        config.shutdownGraceMs,
      )
    : null;
  const scrapingWorker = store && config.scrapingEnabled
    ? new AutomationScrapingWorker(
        store,
        files,
        new Map<string, ServerScrapingExecutor>([
          ["instagram", new InstagramServerScrapingExecutor()],
          ["facebook", new FacebookServerScrapingExecutor()],
        ]),
        config.workerPollMs,
        config.jobTimeoutMs,
        config.shutdownGraceMs,
      )
    : null;

  let draining = false;
  let drainPromise: Promise<void> | null = null;
  const drain = () => {
    if (drainPromise) return drainPromise;
    draining = true;
    drainPromise = Promise.all([
      publishingDryRunWorker?.stop(),
      publishingPreviewWorker?.stop(),
      publishingLiveWorkerPool?.stop(),
      scrapingWorker?.stop(),
      loginManager?.shutdown(),
    ]).then(() => undefined);
    return drainPromise;
  };
  const lifecycle = { isDraining: () => draining, drain };
  const dependencyReady = async () => {
    if (postgres) return automationPostgresReady(postgres);
    return databaseReady;
  };
  const app = createAutomationApp({ config, databaseReady, dependencyReady, store, loginManager, files, lifecycle });
  const server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(config.port, config.host, () => resolve(listener));
    listener.once("error", reject);
  });
  publishingDryRunWorker?.start();
  publishingPreviewWorker?.start();
  publishingLiveWorkerPool?.start();
  scrapingWorker?.start();

  const shutdown = async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await drain();
    sqlite?.close();
    if (postgres) await closeAutomationPostgres(postgres);
  };

  process.stdout.write(
    `AgenticThat automation server listening on http://${config.host}:${config.port} ` +
      `(publishing ${livePublishingEnabled(config) ? `enabled with ${config.liveWorkerCount} worker${config.liveWorkerCount === 1 ? "" : "s"}` : "disabled"}, ${config.databaseEngine} database ${databaseReady ? "ready" : "not ready"}).\n`,
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
