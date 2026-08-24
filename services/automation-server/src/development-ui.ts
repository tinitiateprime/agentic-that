export function developmentConnectPage(options: { internalToken: string; loginEnabled: boolean }) {
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
    input { width: 100%; border: 1px solid #cbd8d3; border-radius: 10px; padding: 11px 12px; font: inherit; background: white; }
    button { border: 0; border-radius: 10px; padding: 11px 16px; background: #167552; color: white; font: inherit; font-weight: 750; cursor: pointer; }
    button.secondary { background: white; color: #245344; border: 1px solid #cbd8d3; }
    button:disabled { cursor: wait; opacity: .55; }
    #accounts { display: grid; gap: 10px; margin-top: 16px; }
    article { display: flex; gap: 14px; align-items: center; padding: 15px; border: 1px solid #dce6e2; border-radius: 13px; }
    article > div { min-width: 0; flex: 1; }
    article strong, article span { display: block; }
    article span { margin-top: 4px; color: #73827d; font-size: 13px; }
    .status { display: inline-flex; width: fit-content; margin-top: 8px; padding: 4px 8px; border-radius: 999px; background: #edf2f0; color: #53645e; font-size: 11px; font-weight: 800; }
    .status.CONNECTED { background: #dcf7e9; color: #11643f; }
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
    @media (max-width: 700px) { form { grid-template-columns: 1fr; } article { align-items: flex-start; flex-wrap: wrap; } }
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
    const terminalStates = new Set(['CONNECTED', 'FAILED', 'CANCELLED', 'EXPIRED']);
    let polling = null;
    let framePolling = null;
    let activeSessionId = null;
    let frameObjectUrl = null;
    let inputQueue = Promise.resolve();

    function message(value, tone = '') {
      messageElement.textContent = value;
      messageElement.className = tone;
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

    async function refresh() {
      const workspaceId = workspaceElement.value.trim();
      if (!workspaceId) return;
      const body = await api('/v1/accounts?workspaceId=' + encodeURIComponent(workspaceId));
      accountsElement.replaceChildren(...body.accounts.map(accountCard));
      if (!body.accounts.length) {
        const empty = document.createElement('p');
        empty.textContent = 'No isolated development accounts yet.';
        accountsElement.replaceChildren(empty);
      }
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

    workspaceElement.addEventListener('change', () => refresh().catch(error => message(error.message, 'error')));
    if (!bootstrap.loginEnabled) message('Server login is disabled in local configuration.', 'error');
    else if (!bootstrap.internalToken) message('The local internal token is not configured.', 'error');
    refresh().catch(error => message(error.message, 'error'));
  </script>
</body>
</html>`;
}
