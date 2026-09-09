export const ACCESS_PREFERENCES_UI_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Mailbridge access</title>
  <style>
    :root {
      color-scheme: light dark;
      --mb-canvas: #f4f7f8;
      --mb-surface: rgba(255, 255, 255, 0.92);
      --mb-surface-strong: #ffffff;
      --mb-ink: #102128;
      --mb-muted: #5d6b71;
      --mb-faint: #859197;
      --mb-line: rgba(27, 65, 79, 0.14);
      --mb-accent: #176b89;
      --mb-accent-strong: #0e5873;
      --mb-on-accent: #ffffff;
      --mb-accent-soft: #e5f3f7;
      --mb-success: #147052;
      --mb-success-soft: #e6f4ee;
      --mb-warning: #8b5b13;
      --mb-warning-soft: #fff5dc;
      --mb-danger: #a13c3c;
      --mb-focus: #52a9c9;
      --mb-shadow: 0 16px 48px rgba(18, 47, 58, 0.11), 0 2px 8px rgba(18, 47, 58, 0.05);
      --mb-radius: 22px;
      font-family: "Avenir Next", "Segoe UI Variable", ui-sans-serif, sans-serif;
      font-synthesis: none;
    }

    :root[data-theme="dark"] {
      --mb-canvas: #111719;
      --mb-surface: rgba(28, 37, 40, 0.96);
      --mb-surface-strong: #222d31;
      --mb-ink: #eef5f6;
      --mb-muted: #b1bec2;
      --mb-faint: #8c999e;
      --mb-line: rgba(210, 235, 241, 0.14);
      --mb-accent: #75c3dc;
      --mb-accent-strong: #9bd7e9;
      --mb-on-accent: #09232c;
      --mb-accent-soft: #183943;
      --mb-success: #7bd3ae;
      --mb-success-soft: #17392f;
      --mb-warning: #efc579;
      --mb-warning-soft: #3a2d17;
      --mb-danger: #f2a1a1;
      --mb-focus: #9bd7e9;
      --mb-shadow: 0 18px 54px rgba(0, 0, 0, 0.34), 0 2px 8px rgba(0, 0, 0, 0.18);
    }

    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) {
        --mb-canvas: #111719;
        --mb-surface: rgba(28, 37, 40, 0.96);
        --mb-surface-strong: #222d31;
        --mb-ink: #eef5f6;
        --mb-muted: #b1bec2;
        --mb-faint: #8c999e;
        --mb-line: rgba(210, 235, 241, 0.14);
        --mb-accent: #75c3dc;
        --mb-accent-strong: #9bd7e9;
        --mb-on-accent: #09232c;
        --mb-accent-soft: #183943;
        --mb-success: #7bd3ae;
        --mb-success-soft: #17392f;
        --mb-warning: #efc579;
        --mb-warning-soft: #3a2d17;
        --mb-danger: #f2a1a1;
        --mb-focus: #9bd7e9;
        --mb-shadow: 0 18px 54px rgba(0, 0, 0, 0.34), 0 2px 8px rgba(0, 0, 0, 0.18);
      }
    }

    * { box-sizing: border-box; }

    [hidden] { display: none !important; }

    html, body { margin: 0; min-width: 0; background: transparent; }

    body {
      padding: 8px;
      color: var(--mb-ink);
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    .card {
      position: relative;
      width: min(100%, 680px);
      margin: 0 auto;
      overflow: hidden;
      border: 1px solid var(--mb-line);
      border-radius: var(--mb-radius);
      background:
        radial-gradient(circle at 100% 0%, color-mix(in srgb, var(--mb-accent-soft) 76%, transparent) 0, transparent 36%),
        var(--mb-surface);
      box-shadow: var(--mb-shadow);
    }

    .accent-line {
      height: 4px;
      background: linear-gradient(90deg, var(--mb-accent-strong), #49a5aa 60%, #a4c96d);
    }

    .inner { padding: 22px 24px 20px; }

    .header {
      display: grid;
      grid-template-columns: 48px minmax(0, 1fr) auto;
      gap: 14px;
      align-items: start;
    }

    .mark {
      display: grid;
      place-items: center;
      width: 48px;
      height: 48px;
      border: 1px solid color-mix(in srgb, var(--mb-accent) 26%, transparent);
      border-radius: 15px;
      color: var(--mb-accent-strong);
      background: var(--mb-accent-soft);
    }

    .mark svg { width: 25px; height: 25px; }

    .eyebrow {
      margin: 1px 0 4px;
      color: var(--mb-accent-strong);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      font-size: clamp(22px, 4vw, 28px);
      line-height: 1.14;
      letter-spacing: -0.025em;
      font-weight: 650;
    }

    .subtitle {
      margin: 7px 0 0;
      max-width: 52ch;
      color: var(--mb-muted);
      font-size: 14px;
      line-height: 1.5;
    }

    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-height: 30px;
      padding: 5px 10px;
      border: 1px solid var(--mb-line);
      border-radius: 999px;
      color: var(--mb-muted);
      background: color-mix(in srgb, var(--mb-surface-strong) 82%, transparent);
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
    }

    .status-pill::before {
      content: "";
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--mb-warning);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--mb-warning-soft) 82%, transparent);
    }

    .status-pill.saved::before { background: var(--mb-success); box-shadow: 0 0 0 3px var(--mb-success-soft); }
    .status-pill.cancelled::before { background: var(--mb-faint); box-shadow: none; }

    .summary-grid {
      display: grid;
      grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
      gap: 12px;
      margin-top: 20px;
    }

    .panel {
      min-width: 0;
      padding: 15px 16px;
      border: 1px solid var(--mb-line);
      border-radius: 16px;
      background: color-mix(in srgb, var(--mb-surface-strong) 86%, transparent);
    }

    .panel-label {
      display: block;
      margin-bottom: 9px;
      color: var(--mb-faint);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .mode-name {
      color: var(--mb-ink);
      font-size: 18px;
      line-height: 1.2;
      font-weight: 650;
      letter-spacing: -0.015em;
    }

    .mode-detail {
      margin: 6px 0 0;
      color: var(--mb-muted);
      font-size: 13px;
      line-height: 1.45;
    }

    .accounts { display: flex; flex-wrap: wrap; gap: 7px; }

    .account-chip {
      max-width: 100%;
      overflow-wrap: anywhere;
      padding: 6px 9px;
      border: 1px solid color-mix(in srgb, var(--mb-accent) 22%, var(--mb-line));
      border-radius: 9px;
      color: var(--mb-accent-strong);
      background: var(--mb-accent-soft);
      font-family: ui-monospace, "SFMono-Regular", "Cascadia Mono", monospace;
      font-size: 12px;
      line-height: 1.25;
    }

    .permission-ledger {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 1px;
      margin-top: 12px;
      overflow: hidden;
      border: 1px solid var(--mb-line);
      border-radius: 16px;
      background: var(--mb-line);
    }

    .permission {
      min-width: 0;
      padding: 13px 12px 12px;
      background: var(--mb-surface-strong);
    }

    .permission-state {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
      color: var(--mb-muted);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .permission-state::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--mb-faint);
    }

    .permission.on .permission-state { color: var(--mb-success); }
    .permission.on .permission-state::before { background: var(--mb-success); }
    .permission.ask .permission-state { color: var(--mb-warning); }
    .permission.ask .permission-state::before { background: var(--mb-warning); }

    .permission-title {
      display: block;
      color: var(--mb-ink);
      font-size: 13px;
      line-height: 1.3;
      font-weight: 600;
    }

    .notice-list { display: grid; gap: 8px; margin-top: 12px; }

    .notice {
      display: grid;
      grid-template-columns: 18px minmax(0, 1fr);
      gap: 9px;
      align-items: start;
      padding: 10px 12px;
      border: 1px solid var(--mb-line);
      border-radius: 12px;
      color: var(--mb-muted);
      background: color-mix(in srgb, var(--mb-surface-strong) 78%, transparent);
      font-size: 12px;
      line-height: 1.45;
    }

    .notice.warning { border-color: color-mix(in srgb, var(--mb-warning) 30%, var(--mb-line)); background: var(--mb-warning-soft); color: var(--mb-warning); }
    .notice svg { width: 17px; height: 17px; margin-top: 1px; flex: none; }

    .actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 18px;
      padding-top: 17px;
      border-top: 1px solid var(--mb-line);
    }

    button {
      min-height: 44px;
      padding: 0 17px;
      border-radius: 12px;
      font: inherit;
      font-size: 14px;
      font-weight: 650;
      cursor: pointer;
      touch-action: manipulation;
      transition: background-color 180ms ease, border-color 180ms ease, color 180ms ease, opacity 180ms ease, box-shadow 180ms ease;
    }

    button:focus-visible { outline: 3px solid color-mix(in srgb, var(--mb-focus) 46%, transparent); outline-offset: 2px; }
    button:disabled { cursor: not-allowed; opacity: 0.46; }

    .secondary {
      border: 1px solid var(--mb-line);
      color: var(--mb-muted);
      background: var(--mb-surface-strong);
    }

    .secondary:hover:not(:disabled) { color: var(--mb-ink); border-color: color-mix(in srgb, var(--mb-accent) 36%, var(--mb-line)); }

    .primary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-width: 128px;
      border: 1px solid transparent;
      color: var(--mb-on-accent);
      background: var(--mb-accent-strong);
      box-shadow: 0 5px 14px color-mix(in srgb, var(--mb-accent) 22%, transparent);
    }

    .primary:hover:not(:disabled) { background: color-mix(in srgb, var(--mb-accent-strong) 88%, #000000); }

    .spinner {
      display: none;
      width: 15px;
      height: 15px;
      border: 2px solid rgba(255, 255, 255, 0.45);
      border-top-color: #ffffff;
      border-radius: 50%;
      animation: spin 700ms linear infinite;
    }

    .primary.loading .spinner { display: block; }

    .sr-status {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .fatal {
      margin-top: 12px;
      color: var(--mb-danger);
      font-size: 12px;
      line-height: 1.45;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    @media (max-width: 580px) {
      body { padding: 4px; }
      .inner { padding: 18px 16px 16px; }
      .header { grid-template-columns: 44px minmax(0, 1fr); }
      .mark { width: 44px; height: 44px; border-radius: 14px; }
      .status-pill { grid-column: 2; justify-self: start; margin-top: 8px; }
      .summary-grid { grid-template-columns: 1fr; }
      .permission-ledger { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .actions { align-items: stretch; }
      .actions button { flex: 1; padding-inline: 12px; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: 1ms !important; transition-duration: 1ms !important; }
    }
  </style>
</head>
<body>
  <main class="card" aria-labelledby="title">
    <div class="accent-line" aria-hidden="true"></div>
    <div class="inner">
      <header class="header">
        <div class="mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3.25" y="5.25" width="17.5" height="13.5" rx="3"></rect>
            <path d="m4.4 7.2 6.1 4.8a2.4 2.4 0 0 0 3 0l6.1-4.8"></path>
            <path d="M17.2 14.1v4.1"></path>
            <path d="M15.15 16.15h4.1"></path>
          </svg>
        </div>
        <div>
          <p class="eyebrow">Mailbridge access</p>
          <h1 id="title">Review before saving</h1>
          <p class="subtitle" id="subtitle">A local permission for future sessions. Nothing changes until you save.</p>
        </div>
        <div class="status-pill" id="status-pill">Waiting for you</div>
      </header>

      <section class="summary-grid" aria-label="Access proposal">
        <div class="panel">
          <span class="panel-label">Account scope</span>
          <div class="accounts" id="accounts"><span class="account-chip">Loading…</span></div>
        </div>
        <div class="panel">
          <span class="panel-label">Permission level</span>
          <div class="mode-name" id="mode-name">Loading…</div>
          <p class="mode-detail" id="mode-detail">Preparing the exact capability summary.</p>
        </div>
      </section>

      <section class="permission-ledger" id="permission-ledger" aria-label="Included capabilities"></section>
      <section class="notice-list" id="notices" aria-label="Important details"></section>
      <p class="fatal" id="fatal" role="alert" hidden></p>

      <footer class="actions" id="actions">
        <button type="button" class="secondary" id="cancel">Cancel</button>
        <button type="button" class="primary" id="save" disabled>
          <span class="spinner" aria-hidden="true"></span>
          <span id="save-label">Save access</span>
        </button>
      </footer>
      <div class="sr-status" id="sr-status" aria-live="polite"></div>
    </div>
  </main>

  <script>
    (() => {
      'use strict';

      const PROTOCOL_VERSION = '2026-01-26';
      const COMMIT_TOOL = 'mailbridge_commit_access_preferences';
      const REQUEST_TIMEOUT_MS = 30_000;
      const SAVE_TIMEOUT_MESSAGE = 'The host did not confirm the save. Check saved access preferences before retrying.';
      const pendingRequests = new Map();
      let nextRequestId = 1;
      let proposalId;
      let proposal;
      let connected = false;
      let settled = false;
      let saving = false;
      let saveAttempted = false;

      const byId = (id) => document.getElementById(id);
      const saveButton = byId('save');
      const cancelButton = byId('cancel');
      const saveLabel = byId('save-label');
      const statusPill = byId('status-pill');
      const srStatus = byId('sr-status');
      const fatal = byId('fatal');

      const modeCopy = {
        'read-only': {
          name: 'Read only',
          detail: 'Inspect mail without creating drafts or changing messages.',
          capabilities: [
            ['Read mail', 'on', 'Included'],
            ['Create drafts', 'off', 'Off'],
            ['Mail state', 'off', 'Off'],
            ['Send mail', 'off', 'Off']
          ]
        },
        drafts: {
          name: 'Read + drafts',
          detail: 'Inspect mail and create unsent drafts. Message state and sending stay off.',
          capabilities: [
            ['Read mail', 'on', 'Included'],
            ['Create drafts', 'on', 'Included'],
            ['Mail state', 'off', 'Off'],
            ['Send mail', 'off', 'Off']
          ]
        },
        full: {
          name: 'Mail management',
          detail: 'Read mail, create drafts, and mark messages read or flagged. Sending stays off.',
          capabilities: [
            ['Read mail', 'on', 'Included'],
            ['Create drafts', 'on', 'Included'],
            ['Mail state', 'on', 'Included'],
            ['Send mail', 'off', 'Off']
          ]
        },
        prompted: {
          name: 'Prompt every send',
          detail: 'Mail management plus a separate exact-content confirmation before each send.',
          capabilities: [
            ['Read mail', 'on', 'Included'],
            ['Create drafts', 'on', 'Included'],
            ['Mail state', 'on', 'Included'],
            ['Send mail', 'ask', 'Ask every time']
          ]
        }
      };

      function withTimeout(promise, message) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(message)), REQUEST_TIMEOUT_MS);
          Promise.resolve(promise).then((result) => {
            clearTimeout(timer);
            resolve(result);
          }, (error) => {
            clearTimeout(timer);
            reject(error);
          });
        });
      }

      function request(method, params) {
        const id = nextRequestId++;
        const response = new Promise((resolve, reject) => {
          pendingRequests.set(id, { resolve, reject });
          window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
        });
        return withTimeout(response, method === 'tools/call'
          ? SAVE_TIMEOUT_MESSAGE
          : 'This host did not connect the access card. Reopen the card in a host that supports MCP Apps.')
          .finally(() => pendingRequests.delete(id));
      }

      function notify(method, params) {
        window.parent.postMessage({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) }, '*');
      }

      function applyHostContext(context) {
        const theme = context && context.theme;
        if (theme === 'light' || theme === 'dark') {
          document.documentElement.dataset.theme = theme;
        }
      }

      function extractProposalId(value, depth) {
        if (!value || typeof value !== 'object' || depth > 8) return undefined;
        const namespaced = value['mailbridge/accessProposal'];
        if (namespaced && typeof namespaced.proposalId === 'string') return namespaced.proposalId;
        for (const child of Object.values(value)) {
          const found = extractProposalId(child, depth + 1);
          if (found) return found;
        }
        return undefined;
      }

      function resultEnvelope(result) {
        return result && (result.structuredContent || result.structured_content || result);
      }

      function normalizeStructured(result) {
        const structured = resultEnvelope(result);
        return structured && structured.ok === true ? structured.data : undefined;
      }

      function addNotice(kind, text) {
        const notice = document.createElement('div');
        notice.className = 'notice' + (kind === 'warning' ? ' warning' : '');
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('fill', 'none');
        icon.setAttribute('stroke', 'currentColor');
        icon.setAttribute('stroke-width', '1.8');
        icon.setAttribute('stroke-linecap', 'round');
        icon.setAttribute('stroke-linejoin', 'round');
        icon.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', kind === 'warning'
          ? 'M12 3.5 21 19H3L12 3.5Zm0 5.2v4.9m0 3.1v.1'
          : 'M12 8v4.8m0 3.2v.1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z');
        icon.appendChild(path);
        const copy = document.createElement('span');
        copy.textContent = text;
        notice.append(icon, copy);
        byId('notices').appendChild(notice);
      }

      function renderProposal(next) {
        if (!next || !modeCopy[next.proposedMode] || !Array.isArray(next.proposedAllowedAccounts)) return;
        proposal = next;
        const copy = modeCopy[next.proposedMode];
        const accounts = byId('accounts');
        accounts.replaceChildren();
        for (const address of next.proposedAllowedAccounts) {
          const chip = document.createElement('span');
          chip.className = 'account-chip';
          chip.textContent = String(address);
          accounts.appendChild(chip);
        }
        byId('mode-name').textContent = copy.name;
        byId('mode-detail').textContent = copy.detail;

        const ledger = byId('permission-ledger');
        ledger.replaceChildren();
        for (const item of copy.capabilities) {
          const cell = document.createElement('div');
          cell.className = 'permission ' + item[1];
          const state = document.createElement('span');
          state.className = 'permission-state';
          state.textContent = item[2];
          const title = document.createElement('span');
          title.className = 'permission-title';
          title.textContent = item[0];
          cell.append(state, title);
          ledger.appendChild(cell);
        }

        const notices = byId('notices');
        notices.replaceChildren();
        addNotice('info', 'This replaces the complete saved account list and takes effect after Mailbridge reconnects.');
        if (next.verification && next.verification.performed === true && next.verification.unmatchedAccounts.length > 0) {
          addNotice('warning', 'Not found in the running Mail.app scope: ' + next.verification.unmatchedAccounts.join(', ') + '.');
        } else if (next.verification && next.verification.performed === false) {
          addNotice('warning', 'Mailbridge could not verify these addresses against Mail.app. Review them carefully before saving.');
        }
        if (next.savedPreferencesDiagnostic) {
          addNotice('warning', 'The existing saved settings are unreadable. Saving will replace them.');
        }
        if (next.shadowedByEnvironment && next.shadowedByEnvironment.mode) {
          addNotice('warning', 'A launch setting currently overrides the saved permission level. The saved level stays inactive until that override is removed.');
        }
        if (next.shadowedByEnvironment && next.shadowedByEnvironment.allowedAccounts) {
          addNotice('warning', 'A launch setting currently overrides the saved account list. The saved list stays inactive until that override is removed.');
        }
        updateReadyState();
      }

      function updateReadyState() {
        const canCall = connected || (window.openai && typeof window.openai.callTool === 'function');
        saveButton.disabled = settled || saving || !(proposal && proposalId && canCall);
        if (settled || saving) return;
        if (proposal && !proposalId) {
          saveLabel.textContent = 'Securing card…';
        } else if (proposal && !canCall) {
          saveLabel.textContent = 'Connecting…';
        } else {
          saveLabel.textContent = 'Save access';
        }
      }

      function consumeToolResult(result) {
        if (settled || saving) return;
        const nextProposal = normalizeStructured(result);
        const nextProposalId = extractProposalId(result, 0);
        if (nextProposal) renderProposal(nextProposal);
        if (nextProposalId) proposalId = nextProposalId;
        updateReadyState();
      }

      function setFatal(message) {
        fatal.hidden = false;
        fatal.textContent = message;
        srStatus.textContent = message;
      }

      function finish(state, title, subtitle) {
        settled = true;
        saveButton.disabled = true;
        cancelButton.disabled = true;
        saveButton.classList.remove('loading');
        statusPill.className = 'status-pill ' + (state === 'saved' ? 'saved' : 'cancelled');
        statusPill.textContent = state === 'saved' ? 'Saved locally' : state === 'closed' ? 'Closed' : 'Not saved';
        byId('title').textContent = title;
        byId('subtitle').textContent = subtitle;
        byId('actions').hidden = true;
        srStatus.textContent = title + '. ' + subtitle;
      }

      async function callCommit(id) {
        if (connected) {
          return request('tools/call', { name: COMMIT_TOOL, arguments: { proposalId: id } });
        }
        if (window.openai && typeof window.openai.callTool === 'function') {
          return withTimeout(window.openai.callTool(COMMIT_TOOL, { proposalId: id }), SAVE_TIMEOUT_MESSAGE);
        }
        throw new Error('This host cannot call the secure save tool.');
      }

      saveButton.addEventListener('click', async () => {
        if (!proposal || !proposalId || settled || saving || saveButton.disabled) return;
        saving = true;
        saveAttempted = true;
        fatal.hidden = true;
        saveButton.disabled = true;
        cancelButton.disabled = true;
        saveButton.classList.add('loading');
        saveLabel.textContent = 'Saving…';
        srStatus.textContent = 'Saving Mailbridge access preferences.';
        try {
          const result = await callCommit(proposalId);
          const structured = resultEnvelope(result);
          if (!result || result.isError || !structured || structured.ok !== true || !structured.data || structured.data.saved !== true) {
            const message = structured && structured.error && structured.error.message;
            throw new Error(message || 'Mailbridge could not save these access settings.');
          }
          finish('saved', 'Access saved', 'Reconnect Mailbridge when you want the new account scope and permission level to take effect.');
        } catch (error) {
          saving = false;
          saveButton.classList.remove('loading');
          saveLabel.textContent = 'Try again';
          saveButton.disabled = false;
          cancelButton.disabled = false;
          setFatal(error instanceof Error ? error.message : 'Mailbridge could not save these access settings.');
        }
      });

      cancelButton.addEventListener('click', () => {
        if (settled || saving) return;
        if (saveAttempted) {
          finish('closed', 'Review closed', 'A save was attempted. Check saved access preferences to confirm the current settings.');
          return;
        }
        finish('cancelled', 'No changes saved', 'The proposed account scope and permission level were discarded.');
      });

      window.addEventListener('message', (event) => {
        if (event.source !== window.parent) return;
        const message = event.data;
        if (!message || message.jsonrpc !== '2.0') return;
        if (message.method === undefined && message.id !== undefined && pendingRequests.has(message.id)) {
          const pending = pendingRequests.get(message.id);
          pendingRequests.delete(message.id);
          if (message.error) pending.reject(new Error(message.error.message || 'Host request failed.'));
          else pending.resolve(message.result);
          return;
        }
        if (message.method === 'ui/notifications/tool-result') {
          consumeToolResult(message.params && message.params.result ? message.params.result : message.params);
        }
        if (message.method === 'ui/notifications/host-context-changed') {
          applyHostContext(message.params);
        }
      }, { passive: true });

      function consumeOpenAiGlobals(globals) {
        if (!globals) return;
        applyHostContext(globals);
        if (settled || saving) return;
        const next = normalizeStructured(globals.toolOutput);
        if (next) renderProposal(next);
        if (globals.toolResponseMetadata) {
          const nextId = extractProposalId(globals.toolResponseMetadata, 0);
          if (nextId) proposalId = nextId;
        }
        updateReadyState();
      }

      window.addEventListener('openai:set_globals', (event) => {
        consumeOpenAiGlobals(event.detail && event.detail.globals);
      }, { passive: true });
      consumeOpenAiGlobals(window.openai);

      request('ui/initialize', {
        appCapabilities: {},
        appInfo: { name: 'Mailbridge access', version: '1.0.0' },
        protocolVersion: PROTOCOL_VERSION
      }).then((result) => {
        connected = true;
        applyHostContext(result && result.hostContext);
        notify('ui/notifications/initialized');
        updateReadyState();
      }).catch((error) => {
        connected = false;
        if (!settled && !(window.openai && typeof window.openai.callTool === 'function')) {
          setFatal(error.message);
        }
        updateReadyState();
      });
    })();
  </script>
</body>
</html>`;
