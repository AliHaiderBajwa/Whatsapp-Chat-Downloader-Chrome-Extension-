const S = {
  CONNECTING: 0, IDLE: 1, NO_CHAT: 2, READY: 3,
  BACKING_UP: 4, COMPLETE: 5, ERROR: 6, CANCELLED: 7
};

const STATUS_ICONS = {
  [S.CONNECTING]: '\u{1F504}',
  [S.IDLE]: '\u2139\uFE0F',
  [S.NO_CHAT]: '\u{1F4AC}',
  [S.READY]: '\u2705',
  [S.BACKING_UP]: '\u{1F504}',
  [S.COMPLETE]: '\u2705',
  [S.CANCELLED]: '\u270B',
  [S.ERROR]: '\u274C'
};

const STATUS_CLASSES = {
  [S.CONNECTING]: 'status-connecting',
  [S.IDLE]: 'status-idle',
  [S.NO_CHAT]: 'status-nochat',
  [S.READY]: 'status-ready',
  [S.BACKING_UP]: 'status-busy',
  [S.COMPLETE]: 'status-success',
  [S.CANCELLED]: 'status-cancelled',
  [S.ERROR]: 'status-error'
};

const STATUS_TEXTS = {
  [S.CONNECTING]: 'Connecting to WhatsApp Web...',
  [S.IDLE]: 'Open WhatsApp Web to begin',
  [S.NO_CHAT]: 'Select a chat to backup',
  [S.READY]: '',
  [S.BACKING_UP]: 'Backing up chat...',
  [S.COMPLETE]: '',
  [S.CANCELLED]: 'Backup cancelled',
  [S.ERROR]: ''
};

let currentState = null;
let detectedChat = false;
let chatName = '';
let pollingInterval = null;
let previewMessages = [];
let totalMessageCount = 0;

const els = {
  status:        document.getElementById('status'),
  statusIcon:    document.getElementById('statusIcon'),
  statusText:    document.getElementById('statusText'),
  chatBar:       document.getElementById('chatBar'),
  chatName:      document.getElementById('chatName'),
  formatGroup:   document.querySelector('.format-group'),
  backupBtn:     document.getElementById('backupBtn'),
  cancelBtn:     document.getElementById('cancelBtn'),
  progressContainer: document.getElementById('progressContainer'),
  progressFill:      document.getElementById('progressFill'),
  progressText:      document.getElementById('progressText'),
  countEstimate:     document.getElementById('countEstimate'),
  msgCount:          document.getElementById('msgCount'),
  filterContainer:   document.getElementById('filterContainer'),
  searchInput:       document.getElementById('searchInput'),
  dateFilter:        document.getElementById('dateFilter'),
  mediaOnly:         document.getElementById('mediaOnly'),
  previewContainer:  document.getElementById('previewContainer'),
  previewCount:      document.getElementById('previewCount'),
  previewList:       document.getElementById('previewList'),
  footerText:        document.getElementById('footerText')
};

function hideFilters() {
  els.filterContainer?.classList.add('hidden');
  els.previewContainer?.classList.add('hidden');
}

function setState(state, payload = {}) {
  currentState = state;

  els.status.className = `status-card ${STATUS_CLASSES[state]}`;
  els.statusIcon.textContent = STATUS_ICONS[state];
  els.statusText.textContent = payload.message || STATUS_TEXTS[state] || '';

  switch (state) {
    case S.CONNECTING:
      els.chatBar.classList.add('hidden');
      els.backupBtn.disabled = true;
      els.backupBtn.querySelector('.btn-text').textContent = 'Checking...';
      els.cancelBtn.classList.add('hidden');
      els.progressContainer.classList.add('hidden');
      els.countEstimate.classList.add('hidden');
      hideFilters();
      stopPolling();
      break;

    case S.IDLE:
      els.chatBar.classList.add('hidden');
      els.backupBtn.disabled = true;
      els.backupBtn.querySelector('.btn-text').textContent = 'Start Backup';
      els.cancelBtn.classList.add('hidden');
      els.progressContainer.classList.add('hidden');
      els.countEstimate.classList.add('hidden');
      hideFilters();
      stopPolling();
      break;

    case S.NO_CHAT:
      els.chatBar.classList.remove('hidden');
      els.chatName.textContent = 'No chat selected';
      els.backupBtn.disabled = true;
      els.backupBtn.querySelector('.btn-text').textContent = 'Start Backup';
      els.cancelBtn.classList.add('hidden');
      els.progressContainer.classList.add('hidden');
      els.countEstimate.classList.add('hidden');
      hideFilters();
      stopPolling();
      break;

    case S.READY:
      chatName = payload.chatName || chatName;
      els.chatBar.classList.remove('hidden');
      els.chatName.textContent = chatName;
      els.backupBtn.disabled = false;
      els.backupBtn.querySelector('.btn-text').textContent = 'Start Backup';
      els.cancelBtn.classList.add('hidden');
      els.progressContainer.classList.add('hidden');
      els.countEstimate.classList.remove('hidden');
      els.msgCount.textContent = payload.msgEstimate || '?';
      hideFilters();
      stopPolling();
      break;

    case S.BACKING_UP:
      els.backupBtn.disabled = true;
      els.backupBtn.querySelector('.btn-text').textContent = 'Backing up...';
      els.cancelBtn.classList.remove('hidden');
      els.progressContainer.classList.remove('hidden');
      els.progressFill.style.width = '2%';
      els.progressText.textContent = 'Starting...';
      hideFilters();
      break;

    case S.COMPLETE:
      els.backupBtn.disabled = false;
      els.backupBtn.querySelector('.btn-text').textContent = 'Download';
      els.cancelBtn.classList.add('hidden');
      els.progressContainer.classList.remove('hidden');
      els.progressFill.style.width = '100%';
      els.progressText.textContent = `Scraped ${payload.count || ''} messages!`;
      if (payload.count) {
        els.msgCount.textContent = payload.count;
      }
      if (payload.previewMessages) {
        previewMessages = payload.previewMessages;
        totalMessageCount = payload.count || previewMessages.length;
        renderPreview(previewMessages);
        els.filterContainer.classList.remove('hidden');
        els.previewContainer.classList.remove('hidden');
        els.footerText.textContent = 'Set filters above, then click Download to export.';
      }
      stopPolling();
      break;

    case S.CANCELLED:
      els.backupBtn.disabled = false;
      els.backupBtn.querySelector('.btn-text').textContent = 'Start Backup';
      els.cancelBtn.classList.add('hidden');
      els.progressContainer.classList.add('hidden');
      hideFilters();
      stopPolling();
      break;

    case S.ERROR:
      els.backupBtn.disabled = false;
      els.backupBtn.querySelector('.btn-text').textContent = 'Retry';
      els.cancelBtn.classList.add('hidden');
      els.progressContainer.classList.add('hidden');
      hideFilters();
      stopPolling();
      break;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  setState(S.CONNECTING);
  await Promise.all([checkActiveTab(), loadPreferences()]);
});

async function checkActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes('web.whatsapp.com')) {
    setState(S.IDLE);
    return;
  }

  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
      if (response && response.status === 'ok') {
        detectedChat = true;
        if (response.chatName) {
          let estimate = '?';
          try {
            const quick = await chrome.tabs.sendMessage(tab.id, { action: 'scrape' });
            if (quick && quick.success) estimate = quick.messageCount;
          } catch {}
          setState(S.READY, { chatName: response.chatName, msgEstimate: estimate });
        } else {
          setState(S.NO_CHAT);
        }
        reattachToActiveSession();
        return;
      }
      if (response) {
        setState(S.IDLE);
        return;
      }
    } catch {}
    if (attempt === 0) setState(S.CONNECTING);
    await new Promise(r => setTimeout(r, 2000));
  }
  setState(S.IDLE, { message: 'Could not connect to WhatsApp Web. Reload the page and try again.' });
}

async function loadPreferences() {
  const { wcb_lastFormat } = await chrome.storage.sync.get('wcb_lastFormat');
  if (wcb_lastFormat) {
    const radio = els.formatGroup.querySelector(`input[value="${wcb_lastFormat}"]`);
    if (radio) radio.checked = true;
  }
}

async function savePreference(format) {
  await chrome.storage.sync.set({ wcb_lastFormat: format });
}

function getSelectedFormat() {
  const checked = els.formatGroup.querySelector('input[name="format"]:checked');
  return checked ? checked.value : 'json';
}

async function reattachToActiveSession() {
  try {
    const status = await chrome.runtime.sendMessage({ action: 'get-status' });
    if (status && status.active) {
      setState(S.BACKING_UP);
      startPolling();
    }
  } catch {}
}

function startPolling() {
  stopPolling();
  pollingInterval = setInterval(async () => {
    try {
      const status = await chrome.runtime.sendMessage({ action: 'get-status' });
      if (!status) return stopPolling();

      if (!status.active) {
        const session = status.latestSession;
        if (session) {
          if (session.status === 'completed') {
            try {
              const preview = await chrome.runtime.sendMessage({ action: 'get-preview' });
              setState(S.COMPLETE, { count: session.messageCount, previewMessages: preview || [] });
            } catch {
              setState(S.COMPLETE, { count: session.messageCount });
            }
          } else if (session.status === 'failed') {
            setState(S.ERROR, { message: 'Backup failed' });
          } else if (session.status === 'cancelled') {
            setState(S.CANCELLED);
          }
        }
        stopPolling();
      }
    } catch {
      stopPolling();
    }
  }, 2000);
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

function renderPreview(messages) {
  els.previewCount.textContent = messages.length;
  els.previewList.innerHTML = messages.map(msg => {
    const sender = msg.sender || 'Unknown';
    const time = msg.timestamp || '';
    const text = msg.text || '';
    const mediaLabel = msg.hasMedia ? ` [${msg.mediaType || 'media'}]` : '';
    return `
      <div class="preview-item${msg.isMine ? ' preview-item--mine' : ''}">
        <div class="preview-item-header">
          <span class="preview-item-sender">${escapeHtml(sender)}</span>
          <span class="preview-item-time">${escapeHtml(time)}</span>
        </div>
        <div class="preview-item-text">${escapeHtml(text)}${mediaLabel ? `<span class="preview-item-media">${escapeHtml(mediaLabel)}</span>` : ''}</div>
      </div>`;
  }).join('');
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return str.replace(/[&<>"']/g, ch => map[ch]);
}

async function handleBackup() {
  if (currentState === S.COMPLETE) {
    await handleFilteredDownload();
    return;
  }

  const format = getSelectedFormat();
  setState(S.BACKING_UP);

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'start-backup',
      format
    });

    if (!response) {
      setState(S.ERROR, { message: 'No response from extension. Try again.' });
      return;
    }

    if (response.success) {
      setState(S.COMPLETE, {
        count: response.messageCount,
        previewMessages: response.previewMessages || []
      });
    } else if (response.cancelled) {
      setState(S.CANCELLED);
    } else {
      setState(S.ERROR, { message: response.error || 'Backup failed' });
    }
  } catch (err) {
    if (err.message && err.message.includes('message port closed')) {
      startPolling();
    } else {
      setState(S.ERROR, { message: err.message || 'An error occurred' });
    }
  }
}

async function handleFilteredDownload() {
  const format = getSelectedFormat();
  const filters = {
    search: els.searchInput.value,
    dateRange: els.dateFilter.value,
    mediaOnly: els.mediaOnly.checked
  };

  els.backupBtn.disabled = true;
  els.backupBtn.querySelector('.btn-text').textContent = 'Downloading...';

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'filtered-download',
      format,
      filters
    });

    if (response && response.success) {
      setState(S.READY, { chatName });
      showToast('Download started!');
    } else {
      setState(S.ERROR, { message: response?.error || 'Download failed' });
    }
  } catch (err) {
    setState(S.ERROR, { message: err.message || 'Download failed' });
  }
}

function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  el.setAttribute('role', 'alert');
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast--visible'));
  setTimeout(() => {
    el.classList.remove('toast--visible');
    setTimeout(() => el.remove(), 300);
  }, 2500);
}

async function handleCancel() {
  try {
    await chrome.runtime.sendMessage({ action: 'cancel-backup' });
  } catch {}
  setState(S.CANCELLED);
}

function updateProgress(count) {
  if (currentState !== S.BACKING_UP) return;
  const pct = Math.min(90, Math.round((count / 10000) * 100));
  els.progressFill.style.width = `${Math.max(2, pct)}%`;
  els.progressText.textContent = `${count.toLocaleString()} messages scraped`;
}

els.formatGroup.addEventListener('change', (e) => {
  if (e.target.name === 'format') {
    savePreference(e.target.value);
  }
});

els.backupBtn.addEventListener('click', handleBackup);
els.cancelBtn.addEventListener('click', handleCancel);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'scrape-progress-relay' && currentState === S.BACKING_UP) {
    updateProgress(msg.current);
  }
});
