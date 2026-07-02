const UTF8_BOM = '\uFEFF';
const MONTHS_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const STORAGE_KEY = 'wcb_backup_sessions';
const MAX_SESSIONS = 5;
const SCRAPE_TIMEOUT_MINUTES = 2;

let activeSessionId = null;
let activeTabId = null;
let lastScrapeData = null;
let lastPreviewMessages = [];

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({ [STORAGE_KEY]: [] });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo.status === 'complete' &&
    tab.url &&
    tab.url.includes('web.whatsapp.com')
  ) {
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content.js']
    }).catch(() => {});
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'scrape-timeout' && activeSessionId) {
    handleCancel(activeSessionId, 'Timeout — took longer than 2 minutes');
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'log':
      console.log(`[WCB] ${message.level || 'info'}: ${message.text}`);
      sendResponse({ ok: true });
      break;

    case 'save-backup':
      handleSaveBackup(message.data, message.format || 'json')
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ success: false, error: e.message }));
      break;

    case 'start-backup':
      handleStartBackup(message.format || 'json', sender.tab?.id)
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ success: false, error: e.message }));
      break;

    case 'cancel-backup':
      handleCancel(activeSessionId, 'Cancelled by user')
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ success: false, error: e.message }));
      break;

    case 'scrape-progress':
      chrome.runtime.sendMessage({
        action: 'scrape-progress-relay',
        current: message.current
      }).catch(() => {});
      sendResponse({ ok: true });
      break;

    case 'get-status':
      getStatus().then((r) => sendResponse(r));
      break;

    case 'filtered-download':
      handleFilteredDownload(message.format || 'json', message.filters || {})
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ success: false, error: e.message }));
      break;

    case 'get-preview':
      sendResponse(lastPreviewMessages || []);
      break;

    default:
      sendResponse({ success: false, error: `Unknown action: ${message.action}` });
  }

  return true;
});

async function getStatus() {
  const sessions = await loadSessions();
  const latest = sessions.length > 0 ? sessions[sessions.length - 1] : null;

  return {
    active: activeSessionId !== null,
    sessionId: activeSessionId,
    latestSession: latest
  };
}

async function handleStartBackup(format, tabId) {
  if (activeSessionId) {
    return { success: false, error: 'A backup is already in progress' };
  }

  if (!tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.includes('web.whatsapp.com')) {
      return { success: false, error: 'Open WhatsApp Web first' };
    }
    tabId = tab.id;
  }

  activeTabId = tabId;

  let ping;
  try {
    ping = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    if (!ping || ping.status !== 'ok') {
      return { success: false, error: 'WhatsApp Web is not ready. Open a chat.' };
    }
  } catch {
    return { success: false, error: 'Cannot reach WhatsApp Web page. Refresh and try again.' };
  }

  const chatName = ping.chatName || 'Unknown';
  const sessionId = crypto.randomUUID();
  activeSessionId = sessionId;

  await saveSession({
    id: sessionId,
    chatName,
    format,
    status: 'in-progress',
    messageCount: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    filename: null
  });

  chrome.alarms.create('scrape-timeout', { delayInMinutes: SCRAPE_TIMEOUT_MINUTES });

  try {
    const result = await chrome.tabs.sendMessage(tabId, { action: 'scrape-deep' });

    chrome.alarms.clear('scrape-timeout');

    if (!result || !result.success) {
      await updateSession(sessionId, {
        status: 'failed',
        completedAt: new Date().toISOString()
      });
      activeSessionId = null;
      activeTabId = null;
      return { success: false, error: result?.error || 'Scraping failed', cancelled: result?.cancelled };
    }

    await updateSession(sessionId, {
      messageCount: result.messageCount,
      status: 'completed',
      completedAt: new Date().toISOString()
    });

    lastScrapeData = {
      chatName: result.chatName,
      exportedAt: new Date().toISOString(),
      messageCount: result.messageCount,
      messages: result.messages,
      participantCount: result.participantCount
    };

    lastPreviewMessages = result.messages.slice(0, 10).map(m => ({
      sender: m.sender,
      text: m.text || '',
      timestamp: m.timestamp,
      hasMedia: !!m.hasMedia,
      mediaType: m.mediaType || '',
      isMine: m.isMine
    }));

    await cleanOldSessions();
    activeSessionId = null;
    activeTabId = null;

    return {
      success: true,
      sessionId,
      messageCount: result.messageCount,
      previewMessages: lastPreviewMessages,
      cancelled: result.cancelled
    };
  } catch (err) {
    chrome.alarms.clear('scrape-timeout');
    await updateSession(sessionId, {
      status: 'failed',
      completedAt: new Date().toISOString()
    });
    activeSessionId = null;
    activeTabId = null;
    return { success: false, error: err.message };
  }
}

async function handleFilteredDownload(format, filters) {
  if (!lastScrapeData) {
    return { success: false, error: 'No scraped data available. Start a backup first.' };
  }

  let messages = lastScrapeData.messages;

  if (filters.search) {
    const q = filters.search.toLowerCase();
    messages = messages.filter(m => (m.text || '').toLowerCase().includes(q));
  }

  if (filters.dateRange) {
    const now = Date.now();
    const ranges = {
      '24h': 86400000,
      '7d': 604800000,
      '30d': 2592000000
    };
    const ms = ranges[filters.dateRange];
    if (ms) {
      messages = messages.filter(m => {
        const t = new Date(m.timestamp).getTime();
        return !isNaN(t) && (now - t) <= ms;
      });
    }
  }

  if (filters.mediaOnly) {
    messages = messages.filter(m => m.hasMedia);
  }

  const data = {
    ...lastScrapeData,
    messages,
    messageCount: messages.length
  };

  const downloadResult = await handleSaveBackup(data, format);
  return downloadResult;
}

async function handleCancel(sessionId, reason) {
  if (!sessionId) return { success: false, error: 'No active session' };

  if (activeTabId) {
    try {
      await chrome.tabs.sendMessage(activeTabId, { action: 'cancel-scrape' });
    } catch {}
  }

  await updateSession(sessionId, {
    status: 'cancelled',
    completedAt: new Date().toISOString()
  });

  chrome.alarms.clear('scrape-timeout');

  activeSessionId = null;
  activeTabId = null;

  return { success: true, reason };
}

function loadSessions() {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      resolve(result[STORAGE_KEY] || []);
    });
  });
}

function saveSession(session) {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const sessions = result[STORAGE_KEY] || [];
      sessions.push(session);
      chrome.storage.local.set({ [STORAGE_KEY]: sessions }, resolve);
    });
  });
}

function updateSession(sessionId, updates) {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const sessions = result[STORAGE_KEY] || [];
      const idx = sessions.findIndex((s) => s.id === sessionId);
      if (idx !== -1) {
        sessions[idx] = { ...sessions[idx], ...updates };
        chrome.storage.local.set({ [STORAGE_KEY]: sessions }, resolve);
      } else {
        resolve();
      }
    });
  });
}

function cleanOldSessions() {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      let sessions = result[STORAGE_KEY] || [];
      sessions.sort((a, b) => {
        const da = a.startedAt ? new Date(a.startedAt) : new Date(0);
        const db = b.startedAt ? new Date(b.startedAt) : new Date(0);
        return db - da;
      });
      if (sessions.length > MAX_SESSIONS) {
        sessions = sessions.slice(0, MAX_SESSIONS);
      }
      chrome.storage.local.set({ [STORAGE_KEY]: sessions }, resolve);
    });
  });
}

async function handleSaveBackup(data, format) {
  let content, filename, mimeType;

  switch (format) {
    case 'json':
      content = exportJSON(data);
      filename = generateFilename(data.chatName, data.exportedAt, 'json');
      mimeType = 'application/json';
      break;
    case 'txt':
      content = exportTXT(data);
      filename = generateFilename(data.chatName, data.exportedAt, 'txt');
      mimeType = 'text/plain';
      break;
    case 'html':
      content = exportHTML(data);
      filename = generateFilename(data.chatName, data.exportedAt, 'html');
      mimeType = 'text/html';
      break;
    default:
      return { success: false, error: `Unknown format: ${format}` };
  }

  try {
    const dataUri = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
    const downloadId = await chrome.downloads.download({
      url: dataUri,
      filename: `WhatsApp-Backups/${filename}`,
      saveAs: true,
      conflictAction: 'uniquify'
    });

    return { success: true, downloadId, filename };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function exportJSON(data) {
  data = validateData(data);
  const info = buildExportInfo(data);

  const output = {
    exportInfo: info,
    messages: data.messages.map(msg => {
      const message = buildMessageText(msg);
      const messageType = msg.hasMedia ? (msg.mediaType || 'media') : 'text';
      const result = {
        timestamp: toISO(msg.timestamp),
        sender: msg.sender || 'Unknown',
        message,
        messageType
      };

      if (msg.hasMedia && msg.media) {
        result.media = { ...msg.media };
      }

      const formatting = extractFormatting(message);
      if (formatting.length > 0) {
        result.formatting = formatting;
      }

      const dir = detectDirection(message);
      if (dir && dir !== 'ltr') {
        result.dir = dir;
      }

      return result;
    })
  };

  return UTF8_BOM + JSON.stringify(output, null, 2);
}

function exportTXT(data) {
  data = validateData(data);
  const info = buildExportInfo(data);
  const lines = [];
  const sep = '='.repeat(57);

  const exportDate = info.exportDate ? formatDate(new Date(info.exportDate)) : nowISO();

  lines.push(`Chat with ${info.contact}`);
  lines.push(`Exported on: ${exportDate}`);
  lines.push(sep);
  lines.push('');

  for (const msg of data.messages) {
    const datePart = msg.timestamp || 'No date';
    const sender = msg.sender || 'Unknown';
    let text = msg.text || '';

    if (msg.hasMedia) {
      const placeholder = buildMediaPlaceholder(msg);
      text = text ? `${text} ${placeholder}` : placeholder;
    }

    const plain = text
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/_(.+?)_/g, '$1')
      .replace(/~(.+?)~/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/```(.+?)```/gs, '$1')
      .replace(/^>\s?/gm, '');

    lines.push(`${datePart} - ${sender}: ${plain}`);
  }

  lines.push('');
  lines.push(sep);
  lines.push(`End of chat — ${info.messageCount} messages exported.`);

  return UTF8_BOM + lines.join('\r\n');
}

function exportHTML(data) {
  data = validateData(data);
  const info = buildExportInfo(data);
  const exportDate = info.exportDate ? formatDate(new Date(info.exportDate)) : nowISO();

  const messageHtml = data.messages.map(msg => {
    const side = msg.isMine ? 'out' : 'in';
    const dir = detectDirection(msg.text || '');
    const dirAttr = dir ? ` dir="${dir}"` : '';

    const rawText = normalizeEmoji(msg.text || '');
    let displayText = esc(rawText);

    if (msg.hasMedia) {
      const type = msg.mediaType || 'media';
      const media = msg.media;
      let meta = type;
      if (media?.filename) meta += ` ${esc(media.filename)}`;
      if (media?.size) meta += ` (${esc(media.size)})`;
      if (media?.duration) meta += ` [${esc(media.duration)}]`;
      const tag = `<span class="media-tag">[${meta}]</span>`;
      displayText = displayText ? `${displayText} ${tag}` : tag;
    }

    const bold = /\*(.+?)\*/g;
    displayText = displayText.replace(bold, '<strong>$1</strong>');
    const italic = /_(.+?)_/g;
    displayText = displayText.replace(italic, '<em>$1</em>');
    const strike = /~(.+?)~/g;
    displayText = displayText.replace(strike, '<s>$1</s>');
    const code = /`([^`]+)`/g;
    displayText = displayText.replace(code, '<code>$1</code>');
    const quote = /^&gt;\s?(.+)/gm;
    displayText = displayText.replace(quote, '<blockquote>$1</blockquote>');

    const badges = [];
    if (msg.isForwarded) badges.push('Forwarded');
    if (msg.isReply) badges.push('Reply');
    const badgeHtml = badges.length
      ? `<div class="message-badges">${badges.map(b => `<span class="badge">${esc(b)}</span>`).join('')}</div>`
      : '';

    return `
      <div class="message message-${side}"${dirAttr}>
        <div class="message-sender">${esc(msg.sender || 'Unknown')}</div>
        ${badgeHtml}
        <div class="message-text">${displayText}</div>
        <div class="message-time">${esc(msg.timestamp || '')}</div>
      </div>`;
  }).join('\n');

  return UTF8_BOM + `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(info.contact)} — Chat Backup</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', sans-serif;
      background: #111b21;
      color: #e9edef;
      max-width: 740px;
      margin: 0 auto;
      padding: 24px 16px;
    }
    .header { margin-bottom: 28px; }
    .header h1 { font-size: 24px; color: #25d366; word-break: break-word; }
    .header .meta { font-size: 14px; color: #8696a0; margin-top: 4px; line-height: 1.5; }
    .messages { display: flex; flex-direction: column; gap: 6px; }
    .message {
      padding: 10px 14px;
      border-radius: 10px;
      max-width: 88%;
      box-shadow: 0 1px 2px rgba(0,0,0,0.15);
      word-wrap: break-word;
    }
    .message-in { background: #202c33; align-self: flex-start; }
    .message-out { background: #005c4b; margin-left: auto; }
    .message-sender { font-size: 13px; font-weight: 600; color: #25d366; margin-bottom: 3px; }
    .message-out .message-sender { color: #87c7a1; }
    .message-text { font-size: 15px; line-height: 1.5; }
    .message-text strong { font-weight: 700; }
    .message-text em { font-style: italic; }
    .message-text s { text-decoration: line-through; }
    .message-text code {
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 13px;
      background: rgba(255,255,255,0.08);
      padding: 1px 5px;
      border-radius: 4px;
    }
    .message-text blockquote {
      border-inline-start: 3px solid #25d366;
      padding-inline-start: 8px;
      margin: 4px 0;
      color: #aebac1;
    }
    .message-time { font-size: 11px; color: #8696a0; text-align: right; margin-top: 6px; }
    .message-time[dir="rtl"] { text-align: left; }
    .media-tag { font-style: italic; color: #8696a0; }
    .message-badges { display: flex; gap: 4px; margin-bottom: 4px; flex-wrap: wrap; }
    .badge { font-size: 10px; padding: 2px 7px; border-radius: 4px; background: #2a3942; color: #8696a0; }
    .message-out .badge { background: #004d3e; color: #87c7a1; }
    [dir="rtl"] .message-text { text-align: right; }
    [dir="ltr"] .message-text { text-align: left; }
    .footer { text-align: center; color: #2a3942; margin-top: 32px; padding-top: 16px; border-top: 1px solid #2a3942; font-size: 13px; }
    @media (prefers-color-scheme: light) {
      body { background: #f0f2f5; color: #111b21; }
      .message-in { background: #fff; }
      .message-out { background: #d9fdd3; }
      .message-out .message-sender { color: #1f7a46; }
      .message-out .badge { background: #b8e6b8; color: #1f5a36; }
      .meta { color: #667781; }
      .message-time { color: #667781; }
    }
    @media print {
      body { background: #fff !important; color: #000 !important; }
      .message { box-shadow: none; border: 1px solid #ddd; }
      .message-in { background: #f5f5f5; }
      .message-out { background: #e8f5e9; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${esc(info.contact)}</h1>
    <div class="meta">
      Exported: ${esc(exportDate)} &middot; ${info.messageCount} messages &middot; ${esc(info.chatType === 'group' ? 'Group chat' : 'Individual chat')}
      ${info.chatType === 'group' && data.participantCount ? `&middot; Participants: ${data.participantCount}` : ''}
    </div>
  </div>
  <div class="messages">
    ${messageHtml}
  </div>
  <div class="footer">
    End of chat — ${info.messageCount} messages exported
  </div>
</body>
</html>`;
}

function generateFilename(chatName, exportDate, ext) {
  const date = (exportDate || nowISO()).slice(0, 10);
  const safe = sanitize(chatName);
  return `WhatsApp_Chat_${safe}_${date}.${ext}`;
}

function esc(str) {
  if (typeof str !== 'string') return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return str.replace(/[&<>"']/g, ch => map[ch]);
}

function sanitize(name) {
  return (name || 'chat-export')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 200) || 'chat-export';
}

function formatDate(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = MONTHS_ABBR[date.getMonth()];
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const mins = String(date.getMinutes()).padStart(2, '0');
  const secs = String(date.getSeconds()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hours}:${mins}:${secs}`;
}

function nowISO() {
  return new Date().toISOString();
}

function toISO(raw) {
  if (!raw) return '';
  const d = new Date(raw);
  return isNaN(d.getTime()) ? raw : d.toISOString();
}

function buildMessageText(msg) {
  if (msg.text && msg.hasMedia) {
    const p = buildMediaPlaceholder(msg);
    return `${msg.text} ${p}`;
  }
  if (msg.hasMedia && !msg.text) {
    return buildMediaPlaceholder(msg);
  }
  return msg.text || '';
}

function buildMediaPlaceholder(msg) {
  const type = msg.mediaType || 'media';
  const media = msg.media;
  if (!media) return `[${type}]`;
  const parts = [`[${type}`];
  if (media.filename) parts.push(media.filename);
  if (media.size) parts.push(media.size);
  if (media.duration) parts.push(media.duration);
  return parts.join(' ') + ']';
}

function detectDirection(text) {
  if (!text) return 'ltr';
  const rtlChars = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
  return rtlChars.test(text) ? 'rtl' : 'ltr';
}

function normalizeEmoji(text) {
  if (!text) return '';
  return text
    .replace(/[\uFE00-\uFE0F]/g, '')
    .replace(/[\u200E\u200F]/g, '')
    .replace(/\u00A0/g, ' ');
}

function extractFormatting(text) {
  if (!text) return [];
  const ranges = [];
  const markers = [
    { regex: /\*(.+?)\*/g, type: 'BOLD' },
    { regex: /_(.+?)_/g, type: 'ITALIC' },
    { regex: /~(.+?)~/g, type: 'STRIKETHROUGH' },
    { regex: /`([^`]+)`/g, type: 'CODE' }
  ];
  for (const { regex, type } of markers) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const plainBefore = text.slice(0, match.index)
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/_(.+?)_/g, '$1')
        .replace(/~(.+?)~/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/```(.+?)```/gs, '$1');
      const offset = plainBefore.length;
      const innerPlain = match[1]
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/_(.+?)_/g, '$1')
        .replace(/~(.+?)~/g, '$1')
        .replace(/`([^`]+)`/g, '$1');
      ranges.push({ offset, length: innerPlain.length, type });
    }
  }
  ranges.sort((a, b) => a.offset - b.offset);
  return ranges;
}

function getUniqueSenders(messages) {
  const set = new Set();
  for (const m of messages) if (m.sender) set.add(m.sender);
  return Array.from(set);
}

function getChatType(messages) {
  const senders = getUniqueSenders(messages).filter(s => s !== 'You');
  return senders.length > 1 ? 'group' : 'individual';
}

function buildExportInfo(data) {
  return {
    contact: data.chatName || 'Unknown',
    exportDate: data.exportedAt || nowISO(),
    messageCount: data.messages ? data.messages.length : 0,
    chatType: getChatType(data.messages || [])
  };
}

function validateData(data) {
  if (!data) throw new Error('No data provided for export');
  if (!data.messages || !Array.isArray(data.messages)) {
    throw new Error('Export data must contain a messages array');
  }
  if (data.messages.length === 0) {
    throw new Error('No messages to export. The chat is empty.');
  }
  if (!data.chatName) throw new Error('Chat name is missing from export data');
  return data;
}
