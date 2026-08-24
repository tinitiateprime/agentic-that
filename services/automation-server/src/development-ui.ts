export function developmentConnectPage(options: {
  internalToken: string;
  loginEnabled: boolean;
  publishingDryRunEnabled: boolean;
  publishingPreviewEnabled: boolean;
  publishingLiveEnabled: boolean;
}) {
  const bootstrap = JSON.stringify(options).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AgenticThat Server Login Lab</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #f4f7f6; color: #17201d; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top left, #e2f4ed, transparent 42%), #f4f7f6; }
    main { width: min(860px, calc(100% - 32px)); margin: 48px auto; }
    header, section { background: rgba(255,255,255,.94); border: 1px solid #dce6e2; border-radius: 18px; box-shadow: 0 14px 40px rgba(25,55,45,.08); }
    header { padding: 28px; }
    h1 { margin: 5px 0 8px; font-size: clamp(28px, 5vw, 42px); letter-spacing: -.04em; }
    h2 { margin: 0; font-size: 19px; }
    p { color: #60706a; line-height: 1.55; }
    .eyebrow { color: #167552; font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
    .notice { margin-top: 18px; padding: 13px 15px; border-radius: 11px; background: #edf8f3; color: #275f4c; font-size: 14px; }
    section { margin-top: 18px; padding: 24px; }
    form { display: grid; grid-template-columns: 1fr 1fr auto; gap: 12px; align-items: end; margin-top: 18px; }
    label { display: grid; gap: 7px; color: #52625c; font-size: 13px; font-weight: 700; }
    input, select, textarea { width: 100%; border: 1px solid #cbd8d3; border-radius: 10px; padding: 11px 12px; font: inherit; background: white; }
    textarea { min-height: 84px; resize: vertical; }
    button { border: 0; border-radius: 10px; padding: 11px 16px; background: #167552; color: white; font: inherit; font-weight: 750; cursor: pointer; }
    button.secondary { background: white; color: #245344; border: 1px solid #cbd8d3; }
    button.danger { background: #9f2f2f; }
    button:disabled { cursor: wait; opacity: .55; }
    #accounts { display: grid; gap: 10px; margin-top: 16px; }
    article { display: flex; gap: 14px; align-items: center; padding: 15px; border: 1px solid #dce6e2; border-radius: 13px; }
    article > div { min-width: 0; flex: 1; }
    article strong, article span { display: block; }
    article span { margin-top: 4px; color: #73827d; font-size: 13px; }
    .status { display: inline-flex; width: fit-content; margin-top: 8px; padding: 4px 8px; border-radius: 999px; background: #edf2f0; color: #53645e; font-size: 11px; font-weight: 800; }
    .status.CONNECTED { background: #dcf7e9; color: #11643f; }
    .status.SCHEDULED { background: #e6f0ff; color: #245a9f; }
    .status.PUBLISHING, .status.VERIFYING { background: #fff1cc; color: #76540b; }
    .status.PUBLISHED { background: #dcf7e9; color: #11643f; }
    .status.FAILED, .status.LOGIN_REQUIRED, .status.UNCERTAIN { background: #fde5e5; color: #912c2c; }
    #message { min-height: 22px; margin: 14px 0 0; font-size: 14px; color: #51615b; }
    #message.error { color: #a23131; }
    #message.success { color: #11643f; }
    #browser-panel[hidden] { display: none; }
    .browser-head { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
    .browser-head > div { min-width: 0; flex: 1; }
    .browser-head p { margin: 4px 0 0; font-size: 13px; }
    .browser-viewport { position: relative; overflow: hidden; border: 1px solid #c9d5d1; border-radius: 13px; background: #17201d; aspect-ratio: 16 / 10; }
    #browser-frame { display: block; width: 100%; height: 100%; object-fit: contain; outline: none; cursor: default; user-select: none; }
    #browser-frame:focus { box-shadow: inset 0 0 0 3px #43a981; }
    .browser-help { margin: 11px 0 0; font-size: 12px; }
    #dry-run-form { grid-template-columns: 1fr 1fr auto; }
    #dry-run-form .dry-caption { grid-column: 1 / -1; }
    .dry-actions { display: flex; gap: 8px; align-items: center; }
    #dry-run-status { min-height: 22px; margin: 14px 0 0; font-size: 14px; color: #51615b; }
    #dry-run-status.error { color: #a23131; }
    #dry-run-status.success { color: #11643f; }
    #preview-result[hidden] { display: none; }
    #preview-result { margin-top: 16px; }
    #preview-frame { display: block; width: 100%; margin-top: 10px; border: 1px solid #c9d5d1; border-radius: 13px; }
    .schedule-form { display: grid; grid-template-columns: minmax(240px, 1fr) auto auto; gap: 12px; align-items: end; margin-top: 18px; }
    #schedule-status { min-height: 22px; margin: 14px 0 0; font-size: 14px; color: #51615b; }
    #schedule-status.error { color: #a23131; }
    #schedule-status.success { color: #11643f; }
    #publishing-jobs { display: grid; gap: 10px; margin-top: 14px; }
    #publishing-jobs article { align-items: flex-start; }
    .job-caption { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .job-actions { display: flex; gap: 8px; align-items: center; }
    .empty-state { margin: 0; padding: 14px; border: 1px dashed #cbd8d3; border-radius: 11px; }
    @media (max-width: 700px) { form { grid-template-columns: 1fr; } article { align-items: flex-start; flex-wrap: wrap; } }
    @media (max-width: 700px) { .schedule-form { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <span class="eyebrow">Isolated local development</span>
      <h1>Server login lab</h1>
      <p>Create a test Instagram connection. AgenticThat opens a dedicated persistent browser profile and detects the authenticated Instagram session without receiving your password.</p>
      <div class="notice">The Instagram browser now runs on the local server and appears inside this page. Use only a test account.</div>
    </header>
    <section>
      <h2>Instagram accounts</h2>
      <form id="account-form">
        <label>Development workspace<input id="workspace" value="local-development" maxlength="160" required /></label>
        <label>Account label<input id="display-name" placeholder="Instagram test account" maxlength="200" required /></label>
        <button id="add-button" type="submit">Add account</button>
      </form>
      <p id="message" role="status"></p>
      <div id="accounts"></div>
    </section>
    <section>
      <h2>Safe publishing worker check</h2>
      <p>Upload one test image and validate the complete server queue path. This mode cannot open Instagram and cannot publish.</p>
      <form id="dry-run-form">
        <label>Connected account<select id="dry-run-account" required></select></label>
        <label>Test image<input id="dry-run-media" type="file" accept="image/jpeg,image/png" required /></label>
        <div class="dry-actions">
          <button id="dry-run-button" type="submit">Run safe check</button>
          <button id="preview-button" class="secondary" type="button">Prepare private preview</button>
          <button id="live-button" class="danger" type="button">Publish test post</button>
        </div>
        <label class="dry-caption">Test caption<textarea id="dry-run-caption" maxlength="2200">AgenticThat local publishing dry run</textarea></label>
      </form>
      <p id="dry-run-status" role="status"></p>
      <div id="preview-result" hidden>
        <strong id="preview-result-title">Private Instagram browser result</strong>
        <p id="preview-result-description">This screenshot is stored only in isolated local development data. The server never clicks Share during a private preview.</p>
        <img id="preview-frame" alt="Instagram composer prepared without publishing" />
      </div>
    </section>
    <section>
      <h2>Scheduled Instagram publishing</h2>
      <p>Choose the account, image, and caption above, then select a future time. The local server must remain running until the post finishes.</p>
      <div class="schedule-form">
        <label>Publish date and time<input id="schedule-at" type="datetime-local" required /></label>
        <button id="schedule-button" class="danger" type="button">Schedule post</button>
        <button id="refresh-jobs-button" class="secondary" type="button">Refresh jobs</button>
      </div>
      <p id="schedule-status" role="status"></p>
      <div id="publishing-jobs"></div>
    </section>
    <section id="browser-panel" hidden>
      <div class="browser-head">
        <div><h2>Instagram server browser</h2><p>Click the browser image, then type normally. AgenticThat forwards input without logging or saving it.</p></div>
        <button id="cancel-login" class="secondary" type="button">Cancel</button>
      </div>
      <div class="browser-viewport">
        <img id="browser-frame" tabindex="0" draggable="false" alt="Live Instagram login browser" />
      </div>
      <p class="browser-help">For this local milestone, frames stay on this computer. Production will require TLS, short-lived authorization, and stricter stream controls.</p>
    </section>
  </main>
  <script>
    const bootstrap = ${bootstrap};
    const form = document.querySelector('#account-form');
    const accountsElement = document.querySelector('#accounts');
    const workspaceElement = document.querySelector('#workspace');
    const displayNameElement = document.querySelector('#display-name');
    const messageElement = document.querySelector('#message');
    const browserPanel = document.querySelector('#browser-panel');
    const browserFrame = document.querySelector('#browser-frame');
    const cancelLogin = document.querySelector('#cancel-login');
    const dryRunForm = document.querySelector('#dry-run-form');
    const dryRunAccount = document.querySelector('#dry-run-account');
    const dryRunMedia = document.querySelector('#dry-run-media');
    const dryRunCaption = document.querySelector('#dry-run-caption');
    const dryRunButton = document.querySelector('#dry-run-button');
    const previewButton = document.querySelector('#preview-button');
    const liveButton = document.querySelector('#live-button');
    const dryRunStatus = document.querySelector('#dry-run-status');
    const previewResult = document.querySelector('#preview-result');
    const previewResultTitle = document.querySelector('#preview-result-title');
    const previewResultDescription = document.querySelector('#preview-result-description');
    const previewFrame = document.querySelector('#preview-frame');
    const scheduleAt = document.querySelector('#schedule-at');
    const scheduleButton = document.querySelector('#schedule-button');
    const refreshJobsButton = document.querySelector('#refresh-jobs-button');
    const scheduleStatus = document.querySelector('#schedule-status');
    const publishingJobs = document.querySelector('#publishing-jobs');
    const terminalStates = new Set(['CONNECTED', 'FAILED', 'CANCELLED', 'EXPIRED']);
    let polling = null;
    let framePolling = null;
    let activeSessionId = null;
    let frameObjectUrl = null;
    let previewObjectUrl = null;
    let inputQueue = Promise.resolve();
    let jobsRefreshTimer = null;
    let accountNames = new Map();

    function message(value, tone = '') {
      messageElement.textContent = value;
      messageElement.className = tone;
    }

    function dryRunMessage(value, tone = '') {
      dryRunStatus.textContent = value;
      dryRunStatus.className = tone;
    }

    function scheduleMessage(value, tone = '') {
      scheduleStatus.textContent = value;
      scheduleStatus.className = tone;
    }

    async function api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        headers: {
          'content-type': 'application/json',
          'x-agenticthat-internal-token': bootstrap.internalToken,
          ...(options.headers || {}),
        },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'The local server request failed.');
      return body;
    }

    function closeWebsiteBrowser() {
      clearTimeout(framePolling);
      framePolling = null;
      activeSessionId = null;
      browserPanel.hidden = true;
      browserFrame.removeAttribute('src');
      if (frameObjectUrl) URL.revokeObjectURL(frameObjectUrl);
      frameObjectUrl = null;
    }

    async function pollFrame(sessionId) {
      if (activeSessionId !== sessionId) return;
      const workspaceId = workspaceElement.value.trim();
      const response = await fetch(
        '/v1/login-sessions/' + encodeURIComponent(sessionId) + '/frame?workspaceId=' + encodeURIComponent(workspaceId),
        { headers: { 'x-agenticthat-internal-token': bootstrap.internalToken }, cache: 'no-store' },
      );
      if (response.ok) {
        const nextUrl = URL.createObjectURL(await response.blob());
        const previousUrl = frameObjectUrl;
        frameObjectUrl = nextUrl;
        browserFrame.src = nextUrl;
        if (previousUrl) URL.revokeObjectURL(previousUrl);
      }
      if (activeSessionId === sessionId) {
        framePolling = setTimeout(() => pollFrame(sessionId).catch(() => undefined), response.ok ? 350 : 600);
      }
    }

    function openWebsiteBrowser(sessionId) {
      if (activeSessionId === sessionId) return;
      closeWebsiteBrowser();
      activeSessionId = sessionId;
      browserPanel.hidden = false;
      browserPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      void pollFrame(sessionId);
    }

    function sendBrowserInput(input) {
      if (!activeSessionId) return;
      const sessionId = activeSessionId;
      inputQueue = inputQueue
        .catch(() => undefined)
        .then(() => api('/v1/login-sessions/' + encodeURIComponent(sessionId) + '/input', {
          method: 'POST',
          body: JSON.stringify({ workspaceId: workspaceElement.value.trim(), input }),
        }))
        .catch(error => message(error.message, 'error'));
    }

    function accountCard(account) {
      const article = document.createElement('article');
      const detail = document.createElement('div');
      const name = document.createElement('strong');
      const platform = document.createElement('span');
      const status = document.createElement('span');
      const button = document.createElement('button');
      name.textContent = account.displayName;
      platform.textContent = 'Instagram · isolated browser profile';
      status.textContent = account.status.replaceAll('_', ' ');
      status.className = 'status ' + account.status;
      button.type = 'button';
      button.dataset.connectAccount = account.id;
      button.textContent = account.status === 'CONNECTED' ? 'Reconnect' : 'Connect Instagram';
      button.disabled = !bootstrap.loginEnabled || !account.enabled;
      detail.append(name, platform, status);
      article.append(detail, button);
      return article;
    }

    function localDateTimeValue(date) {
      return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    }

    function resetScheduleTime(force = false) {
      const minimum = new Date(Date.now() + 60_000);
      scheduleAt.min = localDateTimeValue(minimum);
      const selected = scheduleAt.value ? new Date(scheduleAt.value) : null;
      if (force || !selected || !Number.isFinite(selected.getTime()) || selected.getTime() <= Date.now()) {
        scheduleAt.value = localDateTimeValue(new Date(Date.now() + 10 * 60_000));
      }
    }

    function publishingJobCard(job) {
      const article = document.createElement('article');
      const detail = document.createElement('div');
      const title = document.createElement('strong');
      const timing = document.createElement('span');
      const caption = document.createElement('span');
      const status = document.createElement('span');
      const actions = document.createElement('div');
      title.textContent = accountNames.get(job.accountId) || 'Instagram account';
      timing.textContent = 'Scheduled for ' + new Date(job.scheduledAt).toLocaleString();
      caption.textContent = (job.caption || '(image without caption)').replace(/\s+/g, ' ').trim();
      caption.className = 'job-caption';
      status.textContent = job.state.replaceAll('_', ' ');
      status.className = 'status ' + job.state;
      detail.append(title, timing, caption, status);
      if (job.errorMessage && job.state !== 'CANCELLED') {
        const error = document.createElement('span');
        error.textContent = job.errorMessage;
        detail.append(error);
      }
      actions.className = 'job-actions';
      if (job.state === 'SCHEDULED') {
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'secondary';
        cancel.dataset.cancelPublishingJob = job.id;
        cancel.textContent = 'Cancel';
        actions.append(cancel);
      }
      article.append(detail, actions);
      return article;
    }

    async function refreshPublishingJobs() {
      clearTimeout(jobsRefreshTimer);
      jobsRefreshTimer = null;
      if (!bootstrap.publishingLiveEnabled) {
        publishingJobs.replaceChildren();
        scheduleMessage('Scheduled server publishing is disabled.', 'error');
        return;
      }
      const workspaceId = workspaceElement.value.trim();
      if (!workspaceId) return;
      const body = await api('/v1/publishing/jobs?workspaceId=' + encodeURIComponent(workspaceId) + '&limit=30');
      const jobs = body.jobs || [];
      if (jobs.length) {
        publishingJobs.replaceChildren(...jobs.map(publishingJobCard));
      } else {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'No live publishing jobs yet.';
        publishingJobs.replaceChildren(empty);
      }
      if (jobs.some(job => ['SCHEDULED', 'PUBLISHING', 'VERIFYING'].includes(job.state))) {
        jobsRefreshTimer = setTimeout(() => {
          if (workspaceElement.value.trim() === workspaceId) {
            refreshPublishingJobs().catch(error => scheduleMessage(error.message, 'error'));
          }
        }, 2_000);
      }
    }

    async function refresh() {
      const workspaceId = workspaceElement.value.trim();
      if (!workspaceId) return;
      const body = await api('/v1/accounts?workspaceId=' + encodeURIComponent(workspaceId));
      accountNames = new Map(body.accounts.map(account => [account.id, account.displayName]));
      accountsElement.replaceChildren(...body.accounts.map(accountCard));
      const selectedAccount = dryRunAccount.value;
      const connected = body.accounts.filter(account => account.enabled && account.status === 'CONNECTED');
      dryRunAccount.replaceChildren(...connected.map(account => {
        const option = document.createElement('option');
        option.value = account.id;
        option.textContent = account.displayName;
        return option;
      }));
      if (connected.some(account => account.id === selectedAccount)) dryRunAccount.value = selectedAccount;
      dryRunButton.disabled = !bootstrap.publishingDryRunEnabled || connected.length === 0;
      previewButton.disabled = !bootstrap.publishingPreviewEnabled || connected.length === 0;
      liveButton.disabled = !bootstrap.publishingLiveEnabled || connected.length === 0;
      scheduleButton.disabled = !bootstrap.publishingLiveEnabled || connected.length === 0;
      refreshJobsButton.disabled = !bootstrap.publishingLiveEnabled;
      if (!body.accounts.length) {
        const empty = document.createElement('p');
        empty.textContent = 'No isolated development accounts yet.';
        accountsElement.replaceChildren(empty);
      }
      await refreshPublishingJobs();
    }

    async function uploadDryRunMedia(file) {
      const bitmap = await createImageBitmap(file);
      try {
        const aspectRatio = bitmap.width / bitmap.height;
        if (aspectRatio > 1.911) {
          throw new Error(
            'This image is ' + bitmap.width + '×' + bitmap.height + ' (' + aspectRatio.toFixed(2)
            + ':1). Instagram requires landscape images no wider than 1.91:1. Crop or resize it, then choose the updated file.',
          );
        }
      } finally {
        bitmap.close();
      }
      const response = await fetch('/v1/media', {
        method: 'POST',
        headers: {
          'content-type': file.type,
          'x-agenticthat-internal-token': bootstrap.internalToken,
          'x-agenticthat-workspace-id': workspaceElement.value.trim(),
          'x-agenticthat-file-name': encodeURIComponent(file.name),
        },
        body: file,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'The local media upload failed.');
      return body.media;
    }

    async function pollDryRun(jobId, deadline = Date.now() + 30_000) {
      if (Date.now() > deadline) throw new Error('The dry-run worker did not finish within 30 seconds.');
      const workspaceId = workspaceElement.value.trim();
      const body = await api('/v1/publishing/jobs/' + encodeURIComponent(jobId) + '?workspaceId=' + encodeURIComponent(workspaceId));
      const job = body.job;
      if (job.state === 'SCHEDULED' || job.state === 'PUBLISHING') {
        dryRunMessage(job.state === 'SCHEDULED' ? 'Waiting for the local dry-run worker...' : 'Validating profile, lock, caption, and media...');
        await new Promise(resolve => setTimeout(resolve, 500));
        return pollDryRun(jobId, deadline);
      }
      if (job.errorCode === 'DRY_RUN_COMPLETE') {
        dryRunMessage('All safe worker checks passed. No website was opened and nothing was published.', 'success');
      } else {
        dryRunMessage(job.errorMessage || ('Dry-run finished with status ' + job.state + '.'), 'error');
      }
      return job;
    }

    async function loadStoredFrame(jobId, path, title, description, alt) {
      const workspaceId = workspaceElement.value.trim();
      const response = await fetch(
        path + '?workspaceId=' + encodeURIComponent(workspaceId),
        { headers: { 'x-agenticthat-internal-token': bootstrap.internalToken }, cache: 'no-store' },
      );
      if (!response.ok) throw new Error('The private Instagram screenshot could not be loaded.');
      const nextUrl = URL.createObjectURL(await response.blob());
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = nextUrl;
      previewResultTitle.textContent = title;
      previewResultDescription.textContent = description;
      previewFrame.alt = alt;
      previewFrame.src = nextUrl;
      previewResult.hidden = false;
      previewResult.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    async function loadPreviewFrame(jobId) {
      return loadStoredFrame(
        jobId,
        '/v1/publishing/previews/' + encodeURIComponent(jobId) + '/frame',
        'Private Instagram browser result',
        'This screenshot is stored only in isolated local development data. The server never clicks Share during a private preview.',
        'Instagram composer prepared without publishing',
      );
    }

    async function loadPublishingDiagnostic(jobId) {
      return loadStoredFrame(
        jobId,
        '/v1/publishing/jobs/' + encodeURIComponent(jobId) + '/diagnostic-frame',
        'Instagram publishing diagnostic',
        'This private screenshot shows what Instagram displayed after the single Share attempt. Check the account before retrying.',
        'Instagram state after an unconfirmed Share attempt',
      );
    }

    async function pollPreview(jobId, deadline = Date.now() + 210_000) {
      if (Date.now() > deadline) throw new Error('The Instagram preview worker did not finish within 3.5 minutes.');
      const workspaceId = workspaceElement.value.trim();
      const body = await api('/v1/publishing/jobs/' + encodeURIComponent(jobId) + '?workspaceId=' + encodeURIComponent(workspaceId));
      const job = body.job;
      if (job.state === 'SCHEDULED' || job.state === 'PUBLISHING') {
        dryRunMessage(job.progressMessage || (job.state === 'SCHEDULED'
          ? 'Waiting for the private Instagram preview worker...'
          : 'Opening Instagram and preparing the composer. Share will not be clicked...'));
        await new Promise(resolve => setTimeout(resolve, 750));
        return pollPreview(jobId, deadline);
      }
      if (job.errorCode === 'PREVIEW_COMPLETE') {
        await loadPreviewFrame(jobId);
        dryRunMessage('Private composer preview prepared. Instagram was closed before Share; nothing was published.', 'success');
      } else {
        await loadPreviewFrame(jobId).catch(() => undefined);
        dryRunMessage(job.errorMessage || ('Preview finished with status ' + job.state + '.'), 'error');
      }
      return job;
    }

    async function pollLivePublishing(jobId, deadline = Date.now() + 390_000) {
      if (Date.now() > deadline) throw new Error('The live Instagram worker did not finish within 6.5 minutes. Check the job before retrying.');
      const workspaceId = workspaceElement.value.trim();
      const body = await api('/v1/publishing/jobs/' + encodeURIComponent(jobId) + '?workspaceId=' + encodeURIComponent(workspaceId));
      const job = body.job;
      if (job.state === 'SCHEDULED' || job.state === 'PUBLISHING' || job.state === 'VERIFYING') {
        dryRunMessage(job.progressMessage || (job.state === 'VERIFYING'
          ? 'Instagram Share was submitted. Waiting for confirmation; do not retry.'
          : 'Preparing the authorized Instagram post...'));
        await new Promise(resolve => setTimeout(resolve, 750));
        return pollLivePublishing(jobId, deadline);
      }
      if (job.state === 'PUBLISHED') {
        dryRunMessage('Instagram confirmed the post was published.', 'success');
      } else if (job.state === 'UNCERTAIN') {
        await loadPublishingDiagnostic(jobId).catch(() => undefined);
        dryRunMessage(job.errorMessage || 'Instagram may have received Share, but confirmation was unavailable. Check the account before any retry.', 'error');
      } else {
        dryRunMessage(job.errorMessage || ('Live publishing finished with status ' + job.state + '.'), 'error');
      }
      return job;
    }

    async function pollSession(sessionId) {
      clearTimeout(polling);
      const workspaceId = workspaceElement.value.trim();
      const body = await api('/v1/login-sessions/' + encodeURIComponent(sessionId) + '?workspaceId=' + encodeURIComponent(workspaceId));
      const session = body.session;
      if (session.state === 'AWAITING_USER' && session.surface === 'website') {
        message('Complete login in the Instagram browser below. AgenticThat is waiting...');
        openWebsiteBrowser(sessionId);
      }
      else if (session.state === 'AWAITING_USER') message('Complete login in the visible Instagram browser. AgenticThat is waiting...');
      else if (session.state === 'CONNECTED') message('Instagram session connected and saved. The browser profile is ready.', 'success');
      else if (session.errorMessage) message(session.errorMessage, 'error');
      else message('Login status: ' + session.state.replaceAll('_', ' '));
      if (terminalStates.has(session.state)) {
        closeWebsiteBrowser();
        await refresh();
        return;
      }
      polling = setTimeout(() => pollSession(sessionId).catch(error => message(error.message, 'error')), 750);
    }

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const button = document.querySelector('#add-button');
      button.disabled = true;
      try {
        const body = await api('/v1/accounts', {
          method: 'POST',
          body: JSON.stringify({
            workspaceId: workspaceElement.value.trim(),
            platform: 'instagram',
            displayName: displayNameElement.value.trim(),
          }),
        });
        displayNameElement.value = '';
        await refresh();
        document.querySelector('[data-connect-account="' + CSS.escape(body.account.id) + '"]')?.click();
      } catch (error) {
        message(error.message, 'error');
      } finally {
        button.disabled = false;
      }
    });

    accountsElement.addEventListener('click', async event => {
      const button = event.target.closest('[data-connect-account]');
      if (!button) return;
      button.disabled = true;
      try {
        message('Starting a dedicated Instagram browser inside this page...');
        const body = await api('/v1/accounts/' + encodeURIComponent(button.dataset.connectAccount) + '/login-sessions', {
          method: 'POST',
          body: JSON.stringify({ workspaceId: workspaceElement.value.trim(), surface: 'website' }),
        });
        await pollSession(body.session.id);
      } catch (error) {
        message(error.message, 'error');
      } finally {
        button.disabled = false;
      }
    });

    browserFrame.addEventListener('click', event => {
      if (!browserFrame.naturalWidth || !browserFrame.naturalHeight) return;
      const bounds = browserFrame.getBoundingClientRect();
      const scale = Math.min(bounds.width / browserFrame.naturalWidth, bounds.height / browserFrame.naturalHeight);
      const renderedWidth = browserFrame.naturalWidth * scale;
      const renderedHeight = browserFrame.naturalHeight * scale;
      const offsetX = (bounds.width - renderedWidth) / 2;
      const offsetY = (bounds.height - renderedHeight) / 2;
      const x = (event.clientX - bounds.left - offsetX) / scale;
      const y = (event.clientY - bounds.top - offsetY) / scale;
      if (x < 0 || y < 0 || x > browserFrame.naturalWidth || y > browserFrame.naturalHeight) return;
      browserFrame.focus();
      sendBrowserInput({ type: 'click', x, y, button: 'left' });
    });

    browserFrame.addEventListener('keydown', event => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const special = new Set(['Tab', 'Enter', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Space']);
      if (event.key.length === 1) sendBrowserInput({ type: 'text', text: event.key });
      else if (special.has(event.key)) sendBrowserInput({ type: 'key', key: event.key });
      else return;
      event.preventDefault();
    });

    browserFrame.addEventListener('paste', event => {
      const text = event.clipboardData?.getData('text') || '';
      if (!text) return;
      event.preventDefault();
      for (let offset = 0; offset < text.length; offset += 64) {
        sendBrowserInput({ type: 'text', text: text.slice(offset, offset + 64) });
      }
    });

    browserFrame.addEventListener('wheel', event => {
      event.preventDefault();
      sendBrowserInput({
        type: 'wheel',
        deltaX: Math.max(-2000, Math.min(2000, event.deltaX)),
        deltaY: Math.max(-2000, Math.min(2000, event.deltaY)),
      });
    }, { passive: false });

    cancelLogin.addEventListener('click', async () => {
      if (!activeSessionId) return;
      const sessionId = activeSessionId;
      cancelLogin.disabled = true;
      try {
        await api('/v1/login-sessions/' + encodeURIComponent(sessionId) + '?workspaceId=' + encodeURIComponent(workspaceElement.value.trim()), { method: 'DELETE' });
        closeWebsiteBrowser();
        message('Instagram login cancelled.');
        await refresh();
      } catch (error) {
        message(error.message, 'error');
      } finally {
        cancelLogin.disabled = false;
      }
    });

    dryRunForm.addEventListener('submit', async event => {
      event.preventDefault();
      const file = dryRunMedia.files?.[0];
      if (!file || !dryRunAccount.value) return;
      dryRunButton.disabled = true;
      previewButton.disabled = true;
      liveButton.disabled = true;
      scheduleButton.disabled = true;
      try {
        dryRunMessage('Saving test media into isolated local storage...');
        const media = await uploadDryRunMedia(file);
        dryRunMessage('Creating a non-publishing validation job...');
        const body = await api('/v1/publishing/dry-runs', {
          method: 'POST',
          body: JSON.stringify({
            workspaceId: workspaceElement.value.trim(),
            accountId: dryRunAccount.value,
            scheduledAt: new Date(Date.now() - 1_000).toISOString(),
            originalTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
            caption: dryRunCaption.value,
            media: [{ storageKey: media.storageKey, fileName: media.fileName, mimeType: media.mimeType }],
            idempotencyKey: 'dry-run-' + crypto.randomUUID(),
          }),
        });
        await pollDryRun(body.job.id);
      } catch (error) {
        dryRunMessage(error.message, 'error');
      } finally {
        await refresh().catch(() => undefined);
      }
    });

    previewButton.addEventListener('click', async () => {
      const file = dryRunMedia.files?.[0];
      if (!file || !dryRunAccount.value) {
        dryRunMessage('Choose a connected account and one JPEG or PNG first.', 'error');
        return;
      }
      const confirmed = window.confirm('This will open Instagram on the server and upload the test image into its private composer. The server will stop before Share and close the browser. Continue?');
      if (!confirmed) return;
      dryRunButton.disabled = true;
      previewButton.disabled = true;
      liveButton.disabled = true;
      scheduleButton.disabled = true;
      previewResult.hidden = true;
      try {
        dryRunMessage('Saving test media into isolated local storage...');
        const media = await uploadDryRunMedia(file);
        dryRunMessage('Creating the non-publishing Instagram preview job...');
        const body = await api('/v1/publishing/previews', {
          method: 'POST',
          body: JSON.stringify({
            workspaceId: workspaceElement.value.trim(),
            accountId: dryRunAccount.value,
            scheduledAt: new Date(Date.now() - 1_000).toISOString(),
            originalTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
            caption: dryRunCaption.value,
            media: [{ storageKey: media.storageKey, fileName: media.fileName, mimeType: media.mimeType }],
            idempotencyKey: 'preview-' + crypto.randomUUID(),
          }),
        });
        await pollPreview(body.job.id);
      } catch (error) {
        dryRunMessage(error.message, 'error');
      } finally {
        await refresh().catch(() => undefined);
      }
    });

    liveButton.addEventListener('click', async () => {
      const file = dryRunMedia.files?.[0];
      if (!file || !dryRunAccount.value) {
        dryRunMessage('Choose a connected account and one JPEG or PNG first.', 'error');
        return;
      }
      const confirmation = window.prompt('REAL PUBLISHING: this will click Instagram Share and make the post public. Type PUBLISH to continue.');
      if (confirmation !== 'PUBLISH') {
        dryRunMessage('Live publishing was not authorized. Nothing was published.');
        return;
      }
      dryRunButton.disabled = true;
      previewButton.disabled = true;
      liveButton.disabled = true;
      scheduleButton.disabled = true;
      previewResult.hidden = true;
      try {
        dryRunMessage('Saving authorized publishing media into isolated server storage...');
        const media = await uploadDryRunMedia(file);
        dryRunMessage('Creating the explicitly authorized live Instagram job...');
        const body = await api('/v1/publishing/jobs', {
          method: 'POST',
          body: JSON.stringify({
            workspaceId: workspaceElement.value.trim(),
            accountId: dryRunAccount.value,
            scheduledAt: new Date(Date.now() - 1_000).toISOString(),
            originalTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
            caption: dryRunCaption.value,
            media: [{ storageKey: media.storageKey, fileName: media.fileName, mimeType: media.mimeType }],
            idempotencyKey: 'live-' + crypto.randomUUID(),
            liveConfirmation: confirmation,
          }),
        });
        await pollLivePublishing(body.job.id);
      } catch (error) {
        dryRunMessage(error.message, 'error');
      } finally {
        await refresh().catch(() => undefined);
      }
    });

    scheduleButton.addEventListener('click', async () => {
      const file = dryRunMedia.files?.[0];
      if (!file || !dryRunAccount.value) {
        scheduleMessage('Choose a connected account and one JPEG or PNG in the publishing section above.', 'error');
        return;
      }
      const publishAt = scheduleAt.value ? new Date(scheduleAt.value) : null;
      if (!publishAt || !Number.isFinite(publishAt.getTime()) || publishAt.getTime() < Date.now() + 30_000) {
        scheduleMessage('Choose a publishing time at least 30 seconds in the future.', 'error');
        resetScheduleTime();
        return;
      }
      const confirmation = window.prompt(
        'REAL SCHEDULED PUBLISHING: Instagram Share will be clicked at ' + publishAt.toLocaleString()
        + '. The local server computer must stay running. Type PUBLISH to authorize it.',
      );
      if (confirmation !== 'PUBLISH') {
        scheduleMessage('Scheduled publishing was not authorized. Nothing was queued.');
        return;
      }

      dryRunButton.disabled = true;
      previewButton.disabled = true;
      liveButton.disabled = true;
      scheduleButton.disabled = true;
      try {
        scheduleMessage('Saving authorized publishing media into isolated server storage...');
        const media = await uploadDryRunMedia(file);
        scheduleMessage('Creating the scheduled Instagram publishing job...');
        const body = await api('/v1/publishing/jobs', {
          method: 'POST',
          body: JSON.stringify({
            workspaceId: workspaceElement.value.trim(),
            accountId: dryRunAccount.value,
            scheduledAt: publishAt.toISOString(),
            originalTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
            caption: dryRunCaption.value,
            media: [{ storageKey: media.storageKey, fileName: media.fileName, mimeType: media.mimeType }],
            idempotencyKey: 'scheduled-live-' + crypto.randomUUID(),
            liveConfirmation: confirmation,
          }),
        });
        scheduleMessage('Post scheduled for ' + new Date(body.job.scheduledAt).toLocaleString() + '.', 'success');
        resetScheduleTime(true);
      } catch (error) {
        scheduleMessage(error.message, 'error');
      } finally {
        await refresh().catch(error => scheduleMessage(error.message, 'error'));
      }
    });

    publishingJobs.addEventListener('click', async event => {
      const button = event.target.closest('[data-cancel-publishing-job]');
      if (!button) return;
      if (!window.confirm('Cancel this scheduled post? It can only be cancelled before publishing starts.')) return;
      button.disabled = true;
      try {
        const workspaceId = workspaceElement.value.trim();
        await api(
          '/v1/publishing/jobs/' + encodeURIComponent(button.dataset.cancelPublishingJob)
          + '?workspaceId=' + encodeURIComponent(workspaceId),
          { method: 'DELETE' },
        );
        scheduleMessage('Scheduled post cancelled before publishing started.', 'success');
        await refreshPublishingJobs();
      } catch (error) {
        scheduleMessage(error.message, 'error');
        await refreshPublishingJobs().catch(() => undefined);
      }
    });

    refreshJobsButton.addEventListener('click', async () => {
      refreshJobsButton.disabled = true;
      try {
        await refreshPublishingJobs();
        scheduleMessage('Publishing jobs refreshed.');
      } catch (error) {
        scheduleMessage(error.message, 'error');
      } finally {
        refreshJobsButton.disabled = !bootstrap.publishingLiveEnabled;
      }
    });

    workspaceElement.addEventListener('change', () => refresh().catch(error => message(error.message, 'error')));
    if (!bootstrap.loginEnabled) message('Server login is disabled in local configuration.', 'error');
    else if (!bootstrap.internalToken) message('The local internal token is not configured.', 'error');
    if (!bootstrap.publishingDryRunEnabled) dryRunMessage('Publishing dry-run validation is disabled.', 'error');
    resetScheduleTime(true);
    refresh().catch(error => message(error.message, 'error'));
  </script>
</body>
</html>`;
}
