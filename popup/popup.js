const S = {
  CONNECTING: 0, IDLE: 1, NO_CHAT: 2, READY: 3,
  BACKING_UP: 4, COMPLETE: 5, ERROR: 6, CANCELLED: 7,
  BATCH_SELECT: 8, BATCH_BACKING_UP: 9, BATCH_COMPLETE: 10
};

const STATUS_ICONS = {
  [S.CONNECTING]: '\u{1F504}',
  [S.IDLE]: '\u2139\uFE0F',
  [S.NO_CHAT]: '\u{1F4AC}',
  [S.READY]: '\u2705',
  [S.BACKING_UP]: '\u{1F504}',
  [S.COMPLETE]: '\u2705',
  [S.CANCELLED]: '\u270B',
  [S.ERROR]: '\u274C',
  [S.BATCH_SELECT]: '\u{1F4CB}',
  [S.BATCH_BACKING_UP]: '\u{1F504}',
  [S.BATCH_COMPLETE]: '\u2705'
};

const STATUS_CLASSES = {
  [S.CONNECTING]: 'status-connecting',
  [S.IDLE]: 'status-idle',
  [S.NO_CHAT]: 'status-nochat',
  [S.READY]: 'status-ready',
  [S.BACKING_UP]: 'status-busy',
  [S.COMPLETE]: 'status-success',
  [S.CANCELLED]: 'status-cancelled',
  [S.ERROR]: 'status-error',
  [S.BATCH_SELECT]: 'status-ready',
  [S.BATCH_BACKING_UP]: 'status-busy',
  [S.BATCH_COMPLETE]: 'status-success'
};

const STATUS_TEXTS = {
  [S.CONNECTING]: 'Connecting to WhatsApp Web...',
  [S.IDLE]: 'Open WhatsApp Web to begin',
  [S.NO_CHAT]: 'Select a chat to backup',
  [S.READY]: '',
  [S.BACKING_UP]: 'Backing up chat...',
  [S.COMPLETE]: '',
  [S.CANCELLED]: 'Backup cancelled',
  [S.ERROR]: '',
  [S.BATCH_SELECT]: 'Select chats from the list above',
  [S.BATCH_BACKING_UP]: 'Backing up chats...',
  [S.BATCH_COMPLETE]: ''
};

let currentState = null;
let detectedChat = false;
let chatName = '';
let pollingInterval = null;
let previewMessages = [];
let totalMessageCount = 0;

// Chat list state
let chatListData = [];
let selectedChats = new Set();

const els = {
  status:        document.getElementById('status'),
  statusIcon:    document.getElementById('statusIcon'),
  statusText:    document.getElementById('statusText'),
  chatBar:       document.getElementById('chatBar'),
  chatName:      document.getElementById('chatName'),
  chatListContainer: document.getElementById('chatListContainer'),
  chatList:      document.getElementById('chatList'),
  chatListCount: document.getElementById('chatListCount'),
  selectAllBtn:  document.getElementById('selectAllBtn'),
  formatGroup:   document.querySelector('.format-group'),
  backupBtn:     document.getElementById('backupBtn'),
  backupBtnText: document.querySelector('.btn-text'),
  cancelBtn:     document.getElementById('cancelBtn'),
  progressContainer: document.getElementById('progressContainer'),
  progressFill:      document.getElementById('progressFill'),
  progressText:      document.getElementById('progressText'),
  batchProgressInfo: document.getElementById('batchProgressInfo'),
  batchProgressText: document.getElementById('batchProgressText'),
  countEstimate:     document.getElementById('countEstimate'),
  msgCount:          document.getElementById('msgCount'),
  filterContainer:   document.getElementById('filterContainer'),
  searchInput:       document.getElementById('searchInput'),
  dateFilter:        document.getElementById('dateFilter'),
  mediaOnly:         document.getElementById('mediaOnly'),
  previewContainer:  document.getElementById('previewContainer'),
  previewCount:      document.getElementById('previewCount'),
  previewList:       document.getElementById('previewList'),
  batchResultsContainer: document.getElementById('batchResultsContainer'),
  batchResultsList:      document.getElementById('batchResultsList'),
  footerText:        document.getElementById('footerText')
};

function hideFilters() {
  els.filterContainer?.classList.add('hidden');
  els.previewContainer?.classList.add('hidden');
}

function hideBatchResults() {
  els.batchResultsContainer?.classList.add('hidden');
}

function setState(state, payload = {}) {
  currentState = state;

  els.status.className = `status-card ${STATUS_CLASSES[state]}`;
  els.statusIcon.textContent = STATUS_ICONS[state];
  els.statusText.textContent = payload.message || STATUS_TEXTS[state] || '';

  switch (state) {
    case S.CONNECTING:
      els.chatBar.classList.add('hidden');
      els.chatListContainer.classList.add('hidden');
      els.backupBtn.disabled = true;
      if (els.backupBtnText) els.backupBtnText.textContent = 'Checking...';
      els.cancelBtn.classList.add('hidden');
      els.progressContainer.classList.add('hidden');
      els.batchProgressInfo.classList.add('hidden');
      els.countEstimate.classList.add('hidden');
      hideFilters();
      hideBatchResults();
      stopPolling();
      break;

    case S.IDLE:
      els.chatBar.classList.add('hidden');
      els.chatListContainer.classList.add('hidden');
      els.backupBtn.disabled = true;
      if (els.backupBtnText) els.backupBtnText.textContent = 'Start Backup';
      els.cancelBtn.classList.add('hidden');
      els.progressContainer.classList.add('hidden');
      els.batchProgressInfo.classList.add('hidden');
      els.countEstimate.classList.add('hidden');
      hideFilters();
      hideBatchResults();
      stopPolling();
      break;

    case S.NO_CHAT:
      els.chatBar.classList.remove('hidden');
      els.chatName.textContent = 'No chat selected';
      els.chatListContainer.classList.add('hidden');
      els.backupBtn.disabled = true;
      if (els.backupBtnText) els.backupBtnText.textContent = 'Start Backup';
      els.cancelBtn.classList.add('hidden');
      els.progressContainer.classList.add('hidden');
      els.batchProgressInfo.classList.add('hidden');
      els.countEstimate.classList.add('hidden');
      hideFilters();
      hideBatchResults();
      stopPolling();
      break;

    case S.READY:
      chatName = payload.chatName || chatName;
      els.chatBar.classList.remove('hidden');
      els.chatName.textContent = chatName;
      els.chatListContainer.classList.add('hidden');
      els.backupBtn.disabled = false;
      if (els.backupBtnText) els.backupBtnText.textContent = 'Start Backup';
      els.cancelBtn.classList.add('hidden');
      els.progressContainer.classList.add('hidden');
      els.batchProgressInfo.classList.add('hidden');
      els.countEstimate.classList.remove('hidden');
      els.msgCount.textContent = payload.msgEstimate || '?';
      hideFilters();
      hideBatchResults();
      stopPolling();
      break;

    case S.BATCH_SELECT:
      chatName = '';
      els.chatBar.classList.add('hidden');
      els.chatListContainer.classList.remove('hidden');
      els.backupBtn.disabled = selectedChats.size === 0;
      if (els.backupBtnText) els.backupBtnText.textContent = `Backup Selected (${selectedChats.size})`;
      els.cancelBtn.classList.add('hidden');
      els.progressContainer.classList.add('hidden');
      els.batchProgressInfo.classList.add('hidden');
      els.countEstimate.classList.add('hidden');
      hideFilters();
      hideBatchResults();
      stopPolling();
      break;

    case S.BACKING_UP:
      els.backupBtn.disabled = true;
      if (els.backupBtnText) els.backupBtnText.textContent = 'Backing up...';
      els.cancelBtn.classList.remove('hidden');
      els.progressContainer.classList.remove('hidden');
      els.batchProgressInfo.classList.add('hidden');
      els.progressFill.style.width = '2%';
      els.progressText.textContent = 'Starting...';
      hideFilters();
      hideBatchResults();
      break;

    case S.BATCH_BACKING_UP:
      els.backupBtn.disabled = true;
      if (els.backupBtnText) els.backupBtnText.textContent = 'Backing up...';
      els.cancelBtn.classList.remove('hidden');
      els.progressContainer.classList.remove('hidden');
      els.batchProgressInfo.classList.remove('hidden');
      els.progressFill.style.width = '2%';
      els.progressText.textContent = 'Starting batch...';
      els.batchProgressText.textContent = '';
      hideFilters();
      hideBatchResults();
      break;

    case S.COMPLETE:
      els.backupBtn.disabled = false;
      if (els.backupBtnText) els.backupBtnText.textContent = 'Download';
      els.cancelBtn.classList.add('hidden');
      els.progressContainer.classList.remove('hidden');
      els.batchProgressInfo.classList.add('hidden');
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

    case S.BATCH_COMPLETE:
      els.backupBtn.disabled = false;
      if (els.backupBtnText) els.backupBtnText.textContent = 'Start Backup';
      els.cancelBtn.classList.add('hidden');
      els.progressContainer.classList.remove('hidden');
      els.batchProgressInfo.classList.add('hidden');
      els.progressFill.style.width = '100%';
      els.progressText.textContent = `Batch complete! ${payload.totalChats || 0} chats exported.`;
      if (payload.batchResults) {
        renderBatchResults(payload.batchResults);
        els.batchResultsContainer.classList.remove('hidden');
      }
      hideFilters();
      stopPolling();
      break;

    case S.CANCELLED:
      els.backupBtn.disabled = false;
      if (els.backupBtnText) els.backupBtnText.textContent = 'Start Backup';
      els.cancelBtn.classList.add('hidden');
      els.progressContainer.classList.add('hidden');
      els.batchProgressInfo.classList.add('hidden');
      hideFilters();
      hideBatchResults();
      stopPolling();
      break;

    case S.ERROR:
      els.backupBtn.disabled = false;
      if (els.backupBtnText) els.backupBtnText.textContent = 'Retry';
      els.cancelBtn.classList.add('hidden');
      els.progressContainer.classList.add('hidden');
      els.batchProgressInfo.classList.add('hidden');
      hideFilters();
      hideBatchResults();
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
        // Check if a batch backup is already active FIRST
        const sessionStatus = await chrome.runtime.sendMessage({ action: 'get-status' });
        if (sessionStatus && sessionStatus.active && sessionStatus.batchActive) {
          // Don't override batch state - reattach directly
          reattachToActiveSession();
          return;
        }
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
        // Load chat list for batch selection
        loadChatList(tab.id);
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

async function loadChatList(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'get-chat-list' });
    if (response && response.success && response.chats && response.chats.length > 0) {
      chatListData = response.chats;
      renderChatList(response.chats);
      // Show batch select state if we have chats
      if (currentState === S.READY || currentState === S.NO_CHAT) {
        setState(S.BATCH_SELECT);
      }
    }
  } catch (err) {
    // Chat list not available, stay in current state
    console.log('Could not load chat list:', err.message);
  }
}

function escapeAttribute(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&#38;').replace(/"/g, '&#34;').replace(/'/g, '&#39;').replace(/</g, '&#60;').replace(/>/g, '&#62;');
}

function escapeText(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&#38;').replace(/</g, '&#60;').replace(/>/g, '&#62;');
}

function renderChatList(chats) {
  els.chatList.innerHTML = chats.map((chat, index) => {
    const checked = selectedChats.has(chat.name) ? 'checked' : '';
    const groupBadge = chat.isGroup ? '<span class="chat-list-item-group">Group</span>' : '';
    const unreadBadge = chat.unreadCount > 0 ? `<span class="chat-list-item-unread">${chat.unreadCount}</span>` : '';
    const mutedIcon = chat.isMuted ? '<span class="chat-list-item-muted" title="Muted">&#128263;</span>' : '';
    const lastMsg = chat.lastMessage ? chat.lastMessage.substring(0, 60) : '';
    return [
      '<label class="chat-list-item" data-index="' + index + '">',
        '<input type="checkbox" class="chat-list-checkbox" data-name="' + escapeAttribute(chat.name) + '" ' + checked + ' />',
        '<div class="chat-list-item-content">',
          '<div class="chat-list-item-top">',
            '<span class="chat-list-item-name">' + escapeText(chat.name) + '</span>',
            groupBadge,
            mutedIcon,
            unreadBadge,
          '</div>',
          '<div class="chat-list-item-preview">' + escapeText(lastMsg) + '</div>',
        '</div>',
      '</label>'
    ].join('');
  }).join('');

  // Add event listeners to checkboxes
  els.chatList.querySelectorAll('.chat-list-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const name = e.target.getAttribute('data-name');
      if (e.target.checked) {
        selectedChats.add(name);
      } else {
        selectedChats.delete(name);
      }
      updateChatListCount();
      updateBackupButton();
    });
  });

  updateChatListCount();
}

function updateChatListCount() {
  els.chatListCount.textContent = selectedChats.size + ' of ' + chatListData.length + ' chats selected';
}

function updateBackupButton() {
  if (currentState === S.BATCH_SELECT) {
    els.backupBtn.disabled = selectedChats.size === 0;
    if (els.backupBtnText) {
      els.backupBtnText.textContent = 'Backup Selected (' + selectedChats.size + ')';
    }
  }
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
      if (status.batchActive) {
        setState(S.BATCH_BACKING_UP);
        const current = status.batchCurrent || 0;
        const total = status.batchTotal || 0;
        els.progressText.textContent = 'Batch backup in progress...';
        els.batchProgressText.textContent = 'Chat ' + (current + 1) + ' of ' + total;
        els.progressFill.style.width = Math.max(2, Math.min(90, Math.round(((current + 1) / total) * 100))) + '%';
      } else {
        setState(S.BACKING_UP);
      }
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
      } else if (status.batchActive && currentState !== S.BATCH_BACKING_UP) {
        // Re-attached to an ongoing batch backup after popup re-open
        chatListData = []; // reset chat list
        selectedChats.clear();
        setState(S.BATCH_BACKING_UP);
        const current = status.batchCurrent || 0;
        const total = status.batchTotal || 0;
        els.progressText.textContent = 'Batch backup in progress...';
        els.batchProgressText.textContent = 'Chat ' + (current + 1) + ' of ' + total;
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
    const mediaLabel = msg.hasMedia ? ' [' + (msg.mediaType || 'media') + ']' : '';
    var mineClass = msg.isMine ? ' preview-item--mine' : '';
    return [
      '<div class="preview-item' + mineClass + '">',
        '<div class="preview-item-header">',
          '<span class="preview-item-sender">' + escapeText(sender) + '</span>',
          '<span class="preview-item-time">' + escapeText(time) + '</span>',
        '</div>',
        '<div class="preview-item-text">' + escapeText(text) + (mediaLabel ? '<span class="preview-item-media">' + escapeText(mediaLabel) + '</span>' : '') + '</div>',
      '</div>'
    ].join('');
  }).join('');
}

function renderBatchResults(results) {
  const checkMark = '\u2705';
  const crossMark = '\u274C';
  els.batchResultsList.innerHTML = results.map(function(r) {
    var statusIcon = r.success ? checkMark : crossMark;
    var msgCount = r.messageCount ? r.messageCount + ' msgs' : '';
    var cls = r.success ? 'batch-result-item--success' : 'batch-result-item--fail';
    return [
      '<div class="batch-result-item ' + cls + '">',
        '<span class="batch-result-icon">' + statusIcon + '</span>',
        '<span class="batch-result-name">' + escapeText(r.chatName) + '</span>',
        '<span class="batch-result-meta">' + msgCount + '</span>',
      '</div>'
    ].join('');
  }).join('');
}

async function handleBackup() {
  if (currentState === S.COMPLETE) {
    await handleFilteredDownload();
    return;
  }

  // Batch backup
  if (currentState === S.BATCH_SELECT) {
    await handleBatchBackup();
    return;
  }

  // Single chat backup
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

async function handleBatchBackup() {
  if (selectedChats.size === 0) return;

  const format = getSelectedFormat();
  const chats = Array.from(selectedChats);
  setState(S.BATCH_BACKING_UP);

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'start-batch-backup',
      chats,
      format
    });

    if (!response) {
      setState(S.ERROR, { message: 'No response from extension. Try again.' });
      return;
    }

    if (response.success) {
      setState(S.BATCH_COMPLETE, {
        totalChats: response.totalChats,
        batchResults: response.batchResults
      });
      // Clear selection
      selectedChats.clear();
    } else {
      // Partial failure - show what succeeded and the error
      const partialResults = response.batchResults || [];
      const failedChat = response.failedChat || 'unknown';
      setState(S.BATCH_COMPLETE, {
        totalChats: response.totalChats,
        batchResults: partialResults,
        message: 'Failed at "' + failedChat + '": ' + response.error
      });
      selectedChats.clear();
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
  if (els.backupBtnText) els.backupBtnText.textContent = 'Downloading...';

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
    if (currentState === S.BATCH_BACKING_UP) {
      await chrome.runtime.sendMessage({ action: 'cancel-batch-backup' });
    } else {
      await chrome.runtime.sendMessage({ action: 'cancel-backup' });
    }
  } catch {}
  setState(S.CANCELLED);
}

function updateProgress(count) {
  if (currentState !== S.BACKING_UP && currentState !== S.BATCH_BACKING_UP) return;
  const pct = Math.min(90, Math.round((count / 10000) * 100));
  els.progressFill.style.width = Math.max(2, pct) + '%';
  els.progressText.textContent = count.toLocaleString() + ' messages scraped';
}

function updateBatchProgress(data) {
  if (currentState !== S.BATCH_BACKING_UP) return;
  const current = data.current + 1; // 1-indexed for display
  const total = data.total;
  const pct = Math.min(90, Math.round((current / total) * 100));
  els.progressFill.style.width = Math.max(2, pct) + '%';

  if (data.status === 'opening') {
    els.progressText.textContent = 'Opening "' + data.chatName + '"...';
    els.batchProgressText.textContent = 'Chat ' + current + ' of ' + total;
  } else if (data.status === 'scraping') {
    els.progressText.textContent = 'Scraping "' + data.chatName + '"...';
    els.batchProgressText.textContent = 'Chat ' + current + ' of ' + total;
  } else if (data.status === 'done') {
    els.progressText.textContent = 'Saved "' + data.chatName + '" (' + data.messageCount + ' messages)';
    els.batchProgressText.textContent = 'Chat ' + current + ' of ' + total + ' complete';
  } else if (data.status === 'failed') {
    els.progressText.textContent = 'Failed: ' + (data.error || 'Unknown error');
    els.batchProgressText.textContent = 'Stopped at chat ' + current + ' of ' + total;
  }
}

// Select All button
els.selectAllBtn?.addEventListener('click', () => {
  const allSelected = selectedChats.size === chatListData.length;
  if (allSelected) {
    // Deselect all
    selectedChats.clear();
    els.chatList.querySelectorAll('.chat-list-checkbox').forEach(cb => cb.checked = false);
  } else {
    // Select all
    chatListData.forEach(chat => selectedChats.add(chat.name));
    els.chatList.querySelectorAll('.chat-list-checkbox').forEach(cb => cb.checked = true);
  }
  updateChatListCount();
  updateBackupButton();
  els.selectAllBtn.textContent = selectedChats.size === chatListData.length ? 'Deselect All' : 'Select All';
});

els.formatGroup.addEventListener('change', (e) => {
  if (e.target.name === 'format') {
    savePreference(e.target.value);
  }
});

els.backupBtn.addEventListener('click', handleBackup);
els.cancelBtn.addEventListener('click', handleCancel);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'scrape-progress-relay' && (currentState === S.BACKING_UP || currentState === S.BATCH_BACKING_UP)) {
    updateProgress(msg.current);
  }
  if (msg.action === 'batch-progress') {
    updateBatchProgress(msg);
  }
});