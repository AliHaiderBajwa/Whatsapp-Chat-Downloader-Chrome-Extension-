const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

const HTML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };

export function formatTimestamp(raw) {
  if (!raw) return '';

  const clean = raw.trim();

  const date = new Date(clean);
  if (!isNaN(date.getTime())) {
    return formatDate(date);
  }

  const wa12h = /^(\d{1,2}):(\d{2})\s?(AM|PM)$/i;
  const m = clean.match(wa12h);
  if (m) {
    let hours = parseInt(m[1], 10);
    const mins = m[2];
    const ampm = m[3].toUpperCase();
    if (ampm === 'PM' && hours !== 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
    const d = new Date();
    d.setHours(hours, parseInt(mins, 10), 0, 0);
    return formatDate(d);
  }

  return clean;
}

export function formatDate(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = MONTHS[date.getMonth()];
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const mins = String(date.getMinutes()).padStart(2, '0');
  const secs = String(date.getSeconds()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hours}:${mins}:${secs}`;
}

export function formatISO(raw) {
  if (!raw) return '';
  const d = new Date(raw);
  return isNaN(d.getTime()) ? raw : d.toISOString();
}

export function formatExportDate(isoString) {
  if (!isoString) return new Date().toISOString().slice(0, 10);
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export function sanitizeFileName(name) {
  return (name || 'chat-export')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 200) || 'chat-export';
}

export function escapeHTML(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"']/g, ch => HTML_ESCAPE[ch]);
}

export function detectFormatting(text) {
  if (!text) return { html: '', text: '', hasBold: false, hasItalic: false, hasStrike: false, hasCode: false, hasQuote: false };

  let hasBold = false, hasItalic = false, hasStrike = false, hasCode = false, hasQuote = false;

  let html = escapeHTML(text);

  const codeBlockRegex = /```(.+?)```/gs;
  html = html.replace(codeBlockRegex, (_, code) => {
    hasCode = true;
    return `<code>${escapeHTML(code)}</code>`;
  });

  const inlineCode = /`([^`]+)`/g;
  html = html.replace(inlineCode, (_, code) => {
    hasCode = true;
    return `<code>${escapeHTML(code)}</code>`;
  });

  const boldRegex = /\*(.+?)\*/g;
  html = html.replace(boldRegex, (_, t) => {
    hasBold = true;
    return `<strong>${t}</strong>`;
  });

  const italicRegex = /_(.+?)_/g;
  html = html.replace(italicRegex, (_, t) => {
    hasItalic = true;
    return `<em>${t}</em>`;
  });

  const strikeRegex = /~(.+?)~/g;
  html = html.replace(strikeRegex, (_, t) => {
    hasStrike = true;
    return `<s>${t}</s>`;
  });

  const quoteRegex = /^&gt;\s?(.+)/gm;
  html = html.replace(quoteRegex, (_, t) => {
    hasQuote = true;
    return `<blockquote>${t}</blockquote>`;
  });

  let textPlain = text;
  textPlain = textPlain.replace(/```(.+?)```/gs, '$1');
  textPlain = textPlain.replace(/`([^`]+)`/g, '$1');
  textPlain = textPlain.replace(/\*(.+?)\*/g, '$1');
  textPlain = textPlain.replace(/_(.+?)_/g, '$1');
  textPlain = textPlain.replace(/~(.+?)~/g, '$1');
  textPlain = textPlain.replace(/^>\s?/gm, '');

  return { html, text: textPlain, hasBold, hasItalic, hasStrike, hasCode, hasQuote };
}

export function extractFormatting(text) {
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
      const rawStart = match.index;
      const rawLen = match[0].length;
      const innerLen = match[1].length;
      const plainBefore = text.slice(0, rawStart).replace(/\*(.+?)\*/g, '$1').replace(/_(.+?)_/g, '$1').replace(/~(.+?)~/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/```(.+?)```/gs, '$1');
      const offset = plainBefore.length;
      const innerPlain = match[1].replace(/\*(.+?)\*/g, '$1').replace(/_(.+?)_/g, '$1').replace(/~(.+?)~/g, '$1').replace(/`([^`]+)`/g, '$1');
      ranges.push({ offset, length: innerPlain.length, type });
    }
  }

  ranges.sort((a, b) => a.offset - b.offset);
  return ranges;
}

export function detectDirection(text) {
  if (!text) return 'ltr';
  const rtlChars = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
  return rtlChars.test(text) ? 'rtl' : 'ltr';
}

export function normalizeEmoji(text) {
  if (!text) return '';
  return text
    .replace(/[\uFE00-\uFE0F]/g, '')
    .replace(/[\u200E\u200F]/g, '')
    .replace(/\u00A0/g, ' ');
}

export function truncateText(text, maxLen = 100) {
  if (!text || text.length <= maxLen) return text || '';
  return text.substring(0, maxLen).trimEnd() + '\u2026';
}

export function countMessages(messages) {
  return Array.isArray(messages) ? messages.length : 0;
}

export function getUniqueSenders(messages) {
  const senders = new Set();
  for (const msg of messages) {
    if (msg.sender) senders.add(msg.sender);
  }
  return Array.from(senders);
}

export function getChatType(messages) {
  const senders = getUniqueSenders(messages);
  const nonYouSenders = senders.filter(s => s !== 'You');
  return nonYouSenders.length > 1 ? 'group' : 'individual';
}

export function validateExportData(data) {
  if (!data) {
    throw new Error('No data provided for export');
  }

  if (!data.messages || !Array.isArray(data.messages)) {
    throw new Error('Export data must contain a messages array');
  }

  if (data.messages.length === 0) {
    throw new Error('No messages to export. The chat is empty.');
  }

  if (!data.chatName) {
    throw new Error('Chat name is missing from export data');
  }

  for (let i = 0; i < data.messages.length; i++) {
    const msg = data.messages[i];
    if (!msg.sender || typeof msg.sender !== 'string') {
      data.messages[i] = { ...msg, sender: 'Unknown' };
    }
    if (typeof msg.text !== 'string') {
      data.messages[i] = { ...msg, text: '' };
    }
    if (msg.hasMedia && !msg.mediaType) {
      data.messages[i] = { ...msg, mediaType: 'media' };
    }
  }

  return data;
}

export function toSpecMessages(messages) {
  return messages.map(msg => {
    let messageType = 'text';
    if (msg.hasMedia) {
      messageType = msg.mediaType || 'media';
    }

    let message = msg.text || '';
    if (msg.hasMedia && !message) {
      const mediaInfo = msg.media;
      const parts = [`[${msg.mediaType || 'media'}`];
      if (mediaInfo?.filename) parts.push(mediaInfo.filename);
      if (mediaInfo?.size) parts.push(mediaInfo.size);
      message = parts.join(' ') + ']';
    } else if (msg.hasMedia && message) {
      const mediaInfo = msg.media;
      const meta = [];
      if (mediaInfo?.filename) meta.push(mediaInfo.filename);
      if (mediaInfo?.size) meta.push(mediaInfo.size);
      if (meta.length) message = `${message} [${meta.join(', ')}]`;
    }

    const result = {
      timestamp: formatISO(msg.timestamp),
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
  });
}

export function buildExportInfo(data) {
  return {
    contact: data.chatName || 'Unknown',
    exportDate: data.exportedAt || new Date().toISOString(),
    messageCount: data.messages ? data.messages.length : 0,
    chatType: getChatType(data.messages || [])
  };
}
