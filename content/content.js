(function() {
const SELECTORS = {
  chatListContainer: '#pane-side',
  chatListFallback: '[data-testid="chat-list"]',
  chatRow: 'div[role="row"]',
  chatRowFallback: '[data-testid="cell-frame"]',
  chatName: 'span[dir="auto"]',
  chatNameFallback: 'div[title]',
  lastMessage: '[data-testid="last-msg"]',
  lastMessageFallback: 'span.selectable-text',
  timestamp: '[data-testid="last-msg-time"]',
  timestampFallback: 'time',
  groupIcon: 'svg[data-icon="group"], svg[data-icon="default-group"]',
  messagesIn: 'div.message-in',
  messagesOut: 'div.message-out',
  messageDataId: 'div[data-id]',
  messageSenderData: 'div[data-pre-plain-text]',
  messageText: 'span.selectable-text',
  messageTextFallback: 'div.copyable-text span',
  activeChatHeader: 'section.two > div[tabindex]',
  activeChatHeaderFallback: 'header div[role="button"]'
};

let state = {
  whatsAppReady: false,
  observer: null,
  floatBtn: null,
  toastTimer: null,
  cancelRequested: false,
  isDeepScraping: false
};

init();

async function init() {
  const chatList = await waitForElement(
    SELECTORS.chatListContainer,
    SELECTORS.chatListFallback,
    20000
  );

  if (!chatList) return;

  state.whatsAppReady = true;
  setupMutationObserver(chatList);
  injectFloatingButton();
  showNotification('WhatsApp Chat Backup ready', 'info');
}

function waitForElement(primary, fallback, timeout = 15000) {
  return new Promise((resolve) => {
    const found = query(primary) || query(fallback);
    if (found) return resolve(found);

    const observer = new MutationObserver(() => {
      const el = query(primary) || query(fallback);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      resolve(query(primary) || query(fallback) || null);
    }, timeout);
  });
}

function query(selector) {
  if (!selector) return null;
  return document.querySelector(selector);
}

function queryAll(selector) {
  if (!selector) return [];
  return Array.from(document.querySelectorAll(selector));
}

function setupMutationObserver(container) {
  if (state.observer) state.observer.disconnect();

  state.observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0) {
        updateFloatingButtonVisibility();
        break;
      }
    }
  });

  state.observer.observe(container, { childList: true, subtree: true });
}

function extractChatList() {
  const rows = queryAll(`${SELECTORS.chatListContainer} ${SELECTORS.chatRow}`)
    .filter(el => el.getAttribute('role') === 'row');

  const fallbackRows = rows.length
    ? rows
    : Array.from(queryAll(SELECTORS.chatListFallback))
        .flatMap(list => Array.from(list.querySelectorAll(SELECTORS.chatRowFallback)));

  const chats = [];
  const seen = new Set();

  for (const row of fallbackRows) {
    const name = (
      row.querySelector(SELECTORS.chatName)?.textContent?.trim() ||
      row.querySelector(SELECTORS.chatNameFallback)?.getAttribute('title')?.trim() ||
      row.getAttribute('aria-label')?.trim() ||
      ''
    );

    if (!name || seen.has(name)) continue;
    seen.add(name);

    const lastMessage = (
      row.querySelector(SELECTORS.lastMessage)?.textContent?.trim() ||
      row.querySelector(SELECTORS.lastMessageFallback)?.textContent?.trim() ||
      ''
    );

    const timestamp = (
      row.querySelector(SELECTORS.timestamp)?.textContent?.trim() ||
      row.querySelector(SELECTORS.timestampFallback)?.getAttribute('datetime')?.trim() ||
      row.querySelector(SELECTORS.timestampFallback)?.textContent?.trim() ||
      ''
    );

    const isGroup = !!row.querySelector(SELECTORS.groupIcon);

    const chatId = extractChatIdFromRow(row);

    const id = (
      row.getAttribute('data-testid') ||
      row.getAttribute('aria-label') ||
      name
    );

    const unreadEl = row.querySelector('[data-testid="icon-unread-count"]');
    const unreadCount = unreadEl ? parseInt(unreadEl.textContent, 10) || 0 : 0;

    const isMuted = !!row.querySelector('svg[data-icon="muted"]');

    const pinnedEl = row.closest('[data-testid="pinned"]');
    const isPinned = !!pinnedEl;

    chats.push({
      id,
      chatId,
      name,
      lastMessage,
      timestamp,
      isGroup,
      unreadCount,
      isMuted,
      isPinned
    });
  }

  return chats;
}

function getChatName() {
  return (
    query(`${SELECTORS.activeChatHeader} ${SELECTORS.chatName}`)?.textContent?.trim() ||
    query(`${SELECTORS.activeChatHeaderFallback} ${SELECTORS.chatName}`)?.textContent?.trim() ||
    query(`${SELECTORS.activeChatHeaderFallback} ${SELECTORS.chatNameFallback}`)?.getAttribute('title')?.trim() ||
    ''
  );
}

function getMessageSender(msgEl) {
  const preText = msgEl.querySelector(SELECTORS.messageSenderData);
  if (preText) {
    const raw = preText.getAttribute('data-pre-plain-text') || '';
    const match = raw.match(/\] (.+?):/);
    if (match) return match[1].trim();
    const altMatch = raw.match(/\](.+)$/);
    if (altMatch) return altMatch[1].trim().replace(/:$/, '').trim();
  }

  const quotedSender = msgEl.querySelector('span[title]');
  if (quotedSender) return quotedSender.textContent.trim();

  const senderEl = msgEl.querySelector('[data-testid="conversation-info-header"]');
  if (senderEl) return senderEl.textContent.trim();

  return '';
}

function getMessageTimestamp(msgEl) {
  const preText = msgEl.querySelector(SELECTORS.messageSenderData);
  if (preText) {
    const raw = preText.getAttribute('data-pre-plain-text') || '';
    const match = raw.match(/\[(.*?)\]/);
    if (match) return match[1].trim();
  }

  const titleEl = msgEl.querySelector('[title]');
  if (titleEl && /:/.test(titleEl.textContent)) {
    return titleEl.textContent.trim();
  }

  const timeEl = msgEl.querySelector('time');
  if (timeEl) return timeEl.getAttribute('datetime') || timeEl.textContent.trim();

  const statusEl = msgEl.querySelector('[data-testid="msg-dblcheck"], [data-testid="msg-check"], [data-testid="msg-time"]');
  if (statusEl && statusEl.parentElement) {
    const timeText = statusEl.parentElement.textContent?.trim();
    if (timeText && /\d/.test(timeText)) return timeText;
  }

  return '';
}

function getMessageText(msgEl) {
  const textEl = msgEl.querySelector(SELECTORS.messageText);
  if (textEl) return textEl.textContent.trim();

  const copyableEl = msgEl.querySelector('div.copyable-text');
  if (copyableEl) {
    const spans = copyableEl.querySelectorAll('span');
    const texts = Array.from(spans)
      .filter(s => !s.querySelector('img, video, audio'))
      .map(s => s.textContent)
      .join(' ')
      .trim();
    if (texts) return texts;
  }

  const allText = msgEl.textContent?.trim() || '';
  if (allText && allText !== getMessageSender(msgEl)) {
    let cleanText = allText;
    const quoted = msgEl.querySelector('[data-testid="quoted-message"]');
    if (quoted) {
      cleanText = cleanText.replace(quoted.textContent.trim(), '').trim();
    }
    const lines = cleanText.split('\n').filter(l => l.trim()).slice(0, 3);
    return lines.join(' ').trim();
  }

  return '';
}

function hasMessageMedia(msgEl) {
  return !!(
    msgEl.querySelector('img:not([alt=""]):not([data-testid="image-thumb"])') ||
    msgEl.querySelector('audio') ||
    msgEl.querySelector('video') ||
    msgEl.querySelector('[data-testid="media-doc"]') ||
    msgEl.querySelector('[data-testid="image-thumb"]') ||
    msgEl.querySelector('div[aria-label*="Document"]') ||
    msgEl.querySelector('div[aria-label*="Image"]') ||
    msgEl.querySelector('div[aria-label*="Video"]') ||
    msgEl.querySelector('div[aria-label*="Audio"]') ||
    msgEl.querySelector('div[aria-label*="Sticker"]') ||
    msgEl.querySelector('div[aria-label*="GIF"]') ||
    msgEl.querySelector('[data-testid="sticker"]')
  );
}

function getMessageMediaType(msgEl) {
  if (msgEl.querySelector('video')) return 'video';
  if (msgEl.querySelector('audio')) return 'audio';
  if (msgEl.querySelector('img:not([alt=""]):not([data-testid="image-thumb"])')) return 'image';
  if (msgEl.querySelector('[data-testid="media-doc"]')) return 'document';
  if (msgEl.querySelector('div[aria-label*="Image"], img[data-testid="image-thumb"]')) return 'image';
  if (msgEl.querySelector('div[aria-label*="Video"]')) return 'video';
  if (msgEl.querySelector('div[aria-label*="Audio"]')) return 'audio';
  if (msgEl.querySelector('div[aria-label*="Document"]')) return 'document';
  if (msgEl.querySelector('div[aria-label*="Sticker"]')) return 'sticker';
  if (msgEl.querySelector('div[aria-label*="GIF"]')) return 'gif';
  return '';
}

function getMediaInfo(msgEl) {
  const mediaType = getMessageMediaType(msgEl);
  if (!mediaType) return null;

  let filename = '';
  let size = '';
  let caption = '';
  let duration = '';
  let mimeType = '';

  const docEl = msgEl.querySelector('[data-testid="media-doc"]');
  if (docEl) {
    const textParts = docEl.textContent.trim().split('\n').filter(Boolean);
    if (textParts.length > 0) filename = textParts[0].trim();
    if (textParts.length > 1) {
      const sizeMatch = textParts[1].match(/[\d.]+\s*(KB|MB|GB)/i);
      if (sizeMatch) size = sizeMatch[0];
    }
  }

  const img = msgEl.querySelector('img:not([alt=""]):not([data-testid="image-thumb"])') ||
              msgEl.querySelector('[data-testid="image-thumb"]');
  if (img && !filename) {
    const ariaLabel = findClosestAria(msgEl);
    const nameMatch = ariaLabel ? ariaLabel.match(/(?:Image|Picture|Photo|Sticker|GIF):?\s*(.+)/i) : null;
    if (nameMatch) filename = nameMatch[1].trim();
    if (!filename && img.getAttribute('alt')) filename = img.getAttribute('alt');
    if (!filename && img.src) {
      const srcParts = img.src.split('/');
      const last = srcParts[srcParts.length - 1]?.split('?')[0] || '';
      if (last && last !== 'blob') filename = decodeURIComponent(last);
    }
  }

  const captionEl = msgEl.querySelector('[data-testid="media-caption"]');
  if (captionEl) caption = captionEl.textContent.trim();

  const video = msgEl.querySelector('video');
  if (video && video.duration && !isNaN(video.duration)) {
    const min = Math.floor(video.duration / 60);
    const sec = Math.floor(video.duration % 60);
    duration = `${min}:${String(sec).padStart(2, '0')}`;
  }

  const audio = msgEl.querySelector('audio');
  if (audio && audio.duration && !isNaN(audio.duration)) {
    const min = Math.floor(audio.duration / 60);
    const sec = Math.floor(audio.duration % 60);
    duration = `${min}:${String(sec).padStart(2, '0')}`;
    if (!filename) filename = 'Voice message';
    mimeType = 'audio/ogg';
  }

  const ariaLabel = findClosestAria(msgEl);
  if (!size && ariaLabel) {
    const sizeMatch = ariaLabel.match(/[\d.]+\s*(KB|MB|GB)/i);
    if (sizeMatch) size = sizeMatch[0];
  }
  if (!mimeType && filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const mimeMap = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
      webp: 'image/webp', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm',
      mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
      pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
    mimeType = mimeMap[ext] || '';
  }

  return {
    type: mediaType,
    filename: filename || null,
    size: size || null,
    caption: caption || null,
    duration: duration || null,
    mimeType: mimeType || null
  };
}

function findClosestAria(el) {
  let cur = el;
  while (cur && cur !== document.body) {
    const a = cur.getAttribute('aria-label');
    if (a) return a;
    cur = cur.parentElement;
  }
  return '';
}

function getMessageId(msgEl) {
  return (
    msgEl.getAttribute('data-id') ||
    msgEl.getAttribute('id') ||
    msgEl.querySelector('[data-id]')?.getAttribute('data-id') ||
    ''
  );
}

function detectDirection(text) {
  if (!text) return 'ltr';
  const rtlChars = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
  return rtlChars.test(text) ? 'rtl' : 'ltr';
}

function scrapeMessages() {
  let messageEls = [
    ...queryAll(SELECTORS.messagesIn),
    ...queryAll(SELECTORS.messagesOut)
  ];

  if (messageEls.length === 0) {
    const container = findScrollContainer();
    if (container) {
      messageEls = queryAll(SELECTORS.messageDataId).filter(el => container.contains(el));
    } else {
      messageEls = queryAll(SELECTORS.messageDataId);
    }
  }

  const messages = [];

  for (const msgEl of messageEls) {
    const sender = getMessageSender(msgEl);
    const timestamp = getMessageTimestamp(msgEl);
    const text = getMessageText(msgEl);
    const isMine = msgEl.classList.contains('message-out') || msgEl.parentElement?.classList.contains('message-out');
    const hasMedia = hasMessageMedia(msgEl);
    const mediaType = hasMedia ? getMessageMediaType(msgEl) : '';
    const media = hasMedia ? getMediaInfo(msgEl) : null;
    const isForwarded = !!msgEl.querySelector('[data-testid="forward"], [data-icon="forward"]');
    const isReply = !!msgEl.querySelector('[data-testid="quoted-message"]');
    const msgId = getMessageId(msgEl);

    messages.push({
      id: msgId,
      sender: isMine ? 'You' : (sender || 'Unknown'),
      timestamp,
      text,
      dir: detectDirection(text),
      isMine,
      hasMedia,
      mediaType,
      media,
      isForwarded,
      isReply
    });
  }

  return messages;
}

function detectGroupChat() {
  const groupIcon = document.querySelector('svg[data-icon="group"], svg[data-icon="default-group"]');
  const header = document.querySelector('[data-testid="conversation-info-header"], header');
  if (!groupIcon) return { isGroup: false, participantCount: 0 };
  const participantEl = header?.querySelector('[data-testid="participants"], span[title*=","]');
  let participantCount = 0;
  if (participantEl) {
    const nums = participantEl.textContent.match(/\d+/);
    if (nums) participantCount = parseInt(nums[0], 10);
  }
  return { isGroup: true, participantCount };
}

function scrapeActiveChat() {
  const chatName = getChatName();
  if (!chatName) {
    return { success: false, error: 'No chat is open. Open a chat first.' };
  }

  const messages = scrapeMessages();

  if (messages.length === 0) {
    return { success: false, error: 'No messages found in this chat.' };
  }

  const { isGroup, participantCount } = detectGroupChat();
  const chatType = isGroup ? 'group' : 'individual';

  return {
    success: true,
    chatName,
    messageCount: messages.length,
    messages,
    chatType,
    participantCount
  };
}

function findScrollContainer() {
  const known = document.querySelector('div[tabindex="-1"]');
  if (known && known.scrollHeight > known.clientHeight * 1.5) return known;

  const msg = document.querySelector('div.message-in, div.message-out');
  if (msg) {
    let el = msg.parentElement;
    while (el && el !== document.body) {
      const style = window.getComputedStyle(el);
      if (
        (style.overflowY === 'scroll' || style.overflowY === 'auto') &&
        el.scrollHeight > el.clientHeight * 1.2
      ) {
        return el;
      }
      el = el.parentElement;
    }
  }

  const fallback = document.querySelector('[data-testid="conversation-panel-messages"]');
  if (fallback) return fallback;

  return known || null;
}

function scrollChatUp(container, amount) {
  const before = container.scrollTop;
  container.scrollTop = Math.max(0, before - amount);
  return { moved: container.scrollTop !== before, scrollTop: container.scrollTop };
}

function waitForStableScroll(container, timeout = 3000) {
  return new Promise((resolve) => {
    const start = Date.now();
    let last = container.scrollTop;

    function poll() {
      if (Date.now() - start > timeout) return resolve(false);
      if (container.scrollTop !== last) {
        last = container.scrollTop;
        requestAnimationFrame(poll);
      } else {
        setTimeout(() => {
          if (container.scrollTop === last) resolve(true);
          else requestAnimationFrame(poll);
        }, 250);
      }
    }

    requestAnimationFrame(poll);
  });
}

function deduplicateMessages(existing, fresh) {
  const seen = new Set();
  for (const m of existing) if (m.id) seen.add(m.id);
  const deduped = fresh.filter(m => {
    if (!m.id) return true;
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
  return [...deduped, ...existing];
}

async function scrapeAllMessages(chatName) {
  state.cancelRequested = false;
  state.isDeepScraping = true;

  const container = findScrollContainer();
  if (!container) {
    state.isDeepScraping = false;
    return { success: false, error: 'Cannot find chat message container. Try scrolling manually first.' };
  }

  let allMessages = [];
  const MAX_MESSAGES = 10000;
  const MAX_STALLED = 4;
  const SCROLL_AMOUNT = Math.max(300, Math.floor(container.clientHeight * 0.7));
  let stalledCount = 0;

  allMessages = scrapeMessages();
  reportProgress(allMessages.length);

  while (allMessages.length < MAX_MESSAGES && !state.cancelRequested) {
    const { moved, scrollTop } = scrollChatUp(container, SCROLL_AMOUNT);

    if (!moved) {
      stalledCount++;
      if (stalledCount >= MAX_STALLED) break;
      await delay(600);
      continue;
    }

    stalledCount = 0;
    const settled = await waitForStableScroll(container);
    if (!settled) await delay(500);

    const beforeCount = allMessages.length;
    const freshMessages = scrapeMessages();
    allMessages = deduplicateMessages(allMessages, freshMessages);

    if (allMessages.length === beforeCount) {
      stalledCount++;
      if (stalledCount >= MAX_STALLED) break;
    } else {
      stalledCount = 0;
    }

    reportProgress(allMessages.length);

    await delay(300);
  }

  state.isDeepScraping = false;

  const { isGroup, participantCount } = detectGroupChat();
  const chatType = isGroup ? 'group' : 'individual';

  if (state.cancelRequested) {
    return { success: false, cancelled: true, chatName, messageCount: allMessages.length, messages: allMessages, chatType, participantCount, error: 'Cancelled by user' };
  }

  return { success: true, chatName, messageCount: allMessages.length, messages: allMessages, chatType, participantCount };
}

function reportProgress(current) {
  try {
    chrome.runtime.sendMessage({ action: 'scrape-progress', current, tabScraping: true });
  } catch {}
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function injectFloatingButton() {
  if (state.floatBtn) return;

  const btn = document.createElement('button');
  btn.id = 'wcb-float-btn';
  btn.className = 'wcb-float-btn';
  btn.setAttribute('aria-label', 'Download Chat Backup');
  btn.setAttribute('title', 'Download Chat Backup');

  const icon = document.createElement('span');
  icon.className = 'wcb-float-icon';
  icon.textContent = '⬇';
  icon.setAttribute('aria-hidden', 'true');
  btn.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'wcb-float-label';
  label.textContent = 'Backup Chat';
  btn.appendChild(label);

  btn.addEventListener('click', handleFloatButtonClick);

  document.body.appendChild(btn);
  state.floatBtn = btn;

  requestAnimationFrame(() => btn.classList.add('wcb-float-btn--visible'));
}

function removeFloatingButton() {
  if (state.floatBtn) {
    state.floatBtn.classList.remove('wcb-float-btn--visible');
    setTimeout(() => {
      state.floatBtn?.remove();
      state.floatBtn = null;
    }, 300);
  }
}

function updateFloatingButtonVisibility() {
  if (!state.floatBtn) return;
  const hasChats = !!query(SELECTORS.chatListContainer)?.querySelector(SELECTORS.chatRow);
  state.floatBtn.style.display = hasChats ? '' : 'none';
}

async function handleFloatButtonClick() {
  const btn = state.floatBtn;
  if (!btn || btn.disabled) return;

  const chatName = getChatName();
  if (!chatName) {
    showNotification('Open a chat first', 'error');
    return;
  }

  btn.disabled = true;
  btn.classList.add('wcb-float-btn--loading');

  showNotification('Scraping all messages...', 'info');

  try {
    const result = await scrapeAllMessages(chatName);

    if (result.cancelled) {
      showNotification('Backup cancelled', 'error');
      btn.disabled = false;
      btn.classList.remove('wcb-float-btn--loading');
      return;
    }

    if (!result.success) {
      showNotification(result.error || 'Failed to scrape chat', 'error');
      btn.disabled = false;
      btn.classList.remove('wcb-float-btn--loading');
      return;
    }

    showNotification(`Scraped ${result.messageCount} messages`, 'info');

    const response = await chrome.runtime.sendMessage({
      action: 'save-backup',
      data: {
        chatName: result.chatName,
        exportedAt: new Date().toISOString(),
        messageCount: result.messageCount,
        messages: result.messages
      },
      format: 'json'
    });

    if (response && response.success) {
      showNotification('Download started!', 'success');
    } else {
      showNotification(response?.error || 'Download failed', 'error');
    }
  } catch (err) {
    showNotification(`Error: ${err.message}`, 'error');
  }

  btn.disabled = false;
  btn.classList.remove('wcb-float-btn--loading');
}

function showNotification(text, type = 'info') {
  const existing = document.getElementById('wcb-toast');
  if (existing) existing.remove();

  if (state.toastTimer) {
    clearTimeout(state.toastTimer);
    state.toastTimer = null;
  }

  const toast = document.createElement('div');
  toast.id = 'wcb-toast';
  toast.className = `wcb-toast wcb-toast--${type}`;
  toast.textContent = text;
  toast.setAttribute('role', 'alert');

  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('wcb-toast--visible'));

  state.toastTimer = setTimeout(() => {
    toast.classList.remove('wcb-toast--visible');
    setTimeout(() => toast.remove(), 300);
    state.toastTimer = null;
  }, 4000);
}

function normalizeName(str) {
  if (!str) return '';
  return str.trim().replace(/\s+/g, ' ').normalize('NFKC').toLowerCase();
}

function findClickableElement(row) {
  try {
    const rect = row.getBoundingClientRect();
    const at = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (at && row.contains(at)) return at;
  } catch {}
  for (const sel of ['[data-testid^="cell-frame"]', '[data-testid^="conversation-info"]', '[role="button"]', '[tabindex="0"]']) {
    const el = row.querySelector(sel);
    if (el) return el;
  }
  return row;
}

function extractChatIdFromRow(row) {
  for (const el of row.querySelectorAll('[data-testid]')) {
    const t = el.getAttribute('data-testid');
    if (t && (t.includes('@c.us') || t.includes('@g.us'))) {
      const m = t.match(/[\w.-]+@[cg]\.us/);
      if (m) return m[0];
    }
  }
  for (const el of row.querySelectorAll('[data-id]')) {
    const id = el.getAttribute('data-id');
    if (id && (id.includes('@c.us') || id.includes('@g.us'))) return id;
  }
  return null;
}

function dispatchClickSequence(el) {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const mk = (type, extra) => {
    const o = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, ...extra };
    return type.startsWith('pointer') ? new PointerEvent(type, o) : new MouseEvent(type, o);
  };
  el.dispatchEvent(mk('pointerdown', { pointerId: 1, pointerType: 'mouse', isPrimary: true }));
  el.dispatchEvent(mk('mousedown'));
  el.dispatchEvent(mk('pointerup', { pointerId: 1, pointerType: 'mouse', isPrimary: true }));
  el.dispatchEvent(mk('mouseup'));
  el.dispatchEvent(mk('click'));
}
async function openChat(chatName) {
  const normalizedTarget = normalizeName(chatName);

  const alreadyOpenName = getChatName();
  if (alreadyOpenName && normalizeName(alreadyOpenName) === normalizedTarget) {
    return { success: true, chatName, alreadyOpen: true };
  }

  const pane = query(SELECTORS.chatListContainer) || query(SELECTORS.chatListFallback);
  if (!pane) return { success: false, error: 'Cannot find chat list pane' };

  const rows = queryAll(`${SELECTORS.chatListContainer} ${SELECTORS.chatRow}`).filter(el => el.getAttribute('role') === 'row');
  const allRows = rows.length ? rows : Array.from(queryAll(SELECTORS.chatListFallback)).flatMap(list => Array.from(list.querySelectorAll(SELECTORS.chatRowFallback)));

  let targetRow = null;
  for (const row of allRows) {
    const name = (row.querySelector(SELECTORS.chatName)?.textContent?.trim() || row.querySelector(SELECTORS.chatNameFallback)?.getAttribute('title')?.trim() || row.getAttribute('aria-label')?.trim() || '');
    if (name && normalizeName(name) === normalizedTarget) { targetRow = row; break; }
    if (name && !targetRow && (normalizeName(name).includes(normalizedTarget) || normalizedTarget.includes(normalizeName(name)))) { targetRow = row; }
  }

  if (!targetRow) return { success: false, error: `Chat "${chatName}" not found in the sidebar` };

  for (let attempt = 0; attempt < 3; attempt++) {
    targetRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    await delay(200);

    const clickable = findClickableElement(targetRow);
    dispatchClickSequence(clickable);

    await delay(1500);

    const headerAfter = getChatName();
    const anyMessages = queryAll('div.message-in, div.message-out, div[data-id]');

    if (headerAfter || anyMessages.length > 0) {
      return { success: true, chatName: headerAfter || chatName };
    }

    if (attempt < 2) await delay(1500);
  }

  const chatId = extractChatIdFromRow(targetRow);
  if (chatId) {
    const prefix = chatId.includes('@g.us') ? '#g=' : '#p=';
    window.location.hash = prefix + encodeURIComponent(chatId);
    await delay(2500);
    const h = getChatName();
    if (h) return { success: true, chatName: h };

    window.location.hash = '#p=' + encodeURIComponent(chatId);
    await delay(2000);
    const h2 = getChatName();
    if (h2) return { success: true, chatName: h2 };
  }

  return { success: false, error: `Timeout waiting for chat "${chatName}" to open` };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const sendSafe = (response) => {
    try { sendResponse(response); } catch {}
  };

  switch (request.action) {
    case 'ping':
      sendSafe({
        status: state.whatsAppReady ? 'ok' : 'not-ready',
        chatName: getChatName() || null
      });
      break;

    case 'scrape': {
      const result = scrapeActiveChat();
      sendSafe(result);
      break;
    }

    case 'scrape-deep': {
      // Retry getting chat name a few times to handle DOM transition lag
      (async () => {
        let chatName = getChatName();
        for (let retry = 0; retry < 10 && !chatName; retry++) {
          await delay(500);
          chatName = getChatName();
        }
        if (!chatName) {
          sendSafe({ success: false, error: 'No chat is open. Open a chat first.' });
          return;
        }
        const result = await scrapeAllMessages(chatName);
        try { sendResponse(result); } catch {}
      })();
      return true;
    }

    case 'cancel-scrape':
      state.cancelRequested = true;
      sendSafe({ ok: true });
      break;

    case 'get-chat-list': {
      try {
        const chats = extractChatList();
        sendSafe({ success: true, chats });
      } catch (err) {
        sendSafe({ success: false, error: err.message });
      }
      break;
    }

    case 'open-chat': {
      const name = request.chatName;
      if (!name) {
        sendSafe({ success: false, error: 'No chat name provided' });
        break;
      }
      openChat(name).then((result) => {
        try { sendResponse(result); } catch {}
      });
      return true;
    }

    default:
      sendSafe({ success: false, error: `Unknown action: ${request.action}` });
  }
});
})();