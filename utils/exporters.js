import {
  validateExportData,
  toSpecMessages,
  buildExportInfo,
  escapeHTML,
  detectFormatting,
  sanitizeFileName,
  formatDate,
  formatExportDate,
  detectDirection,
  normalizeEmoji
} from './formatters.js';

const UTF8_BOM = '\uFEFF';

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

export function exportAsTXT(data) {
  data = validateExportData(data);
  const info = buildExportInfo(data);
  const lines = [];
  const sep = '='.repeat(57);

  const exportDate = info.exportDate ? formatDate(new Date(info.exportDate)) : new Date().toISOString();

  lines.push(`Chat with ${info.contact}`);
  lines.push(`Exported on: ${exportDate}`);
  lines.push(sep);
  lines.push('');

  for (const msg of data.messages) {
    const datePart = msg.timestamp ? msg.timestamp : 'No date';
    const sender = msg.sender || 'Unknown';
    let text = msg.text || '';

    if (msg.hasMedia) {
      const placeholder = buildMediaPlaceholder(msg);
      text = text ? `${text} ${placeholder}` : placeholder;
    }

    const { text: plainText } = detectFormatting(text);
    lines.push(`${datePart} - ${sender}: ${plainText}`);
  }

  lines.push('');
  lines.push(sep);
  lines.push(`End of chat — ${info.messageCount} messages exported.`);

  const content = UTF8_BOM + lines.join('\r\n');
  return new Blob([content], { type: 'text/plain;charset=utf-8' });
}

export function exportAsJSON(data) {
  data = validateExportData(data);
  const info = buildExportInfo(data);
  const specMessages = toSpecMessages(data.messages);

  const output = {
    exportInfo: info,
    messages: specMessages
  };

  const content = UTF8_BOM + JSON.stringify(output, null, 2);
  return new Blob([content], { type: 'application/json;charset=utf-8' });
}

export function exportAsHTML(data) {
  data = validateExportData(data);
  const info = buildExportInfo(data);
  const exportDate = info.exportDate ? formatDate(new Date(info.exportDate)) : new Date().toISOString();

  const messageHtml = data.messages.map(msg => {
    const side = msg.isMine ? 'out' : 'in';
    const dir = detectDirection(msg.text || '');
    const dirAttr = dir ? ` dir="${dir}"` : '';

    const rawText = normalizeEmoji(msg.text || '');
    const { html: formattedText } = detectFormatting(rawText);
    let displayText = formattedText || escapeHTML(rawText);

    if (msg.hasMedia) {
      const type = msg.mediaType || 'media';
      const media = msg.media;
      let meta = type;
      if (media?.filename) meta += ` ${escapeHTML(media.filename)}`;
      if (media?.size) meta += ` (${escapeHTML(media.size)})`;
      if (media?.duration) meta += ` [${escapeHTML(media.duration)}]`;
      const tag = `<span class="media-tag">[${meta}]</span>`;
      displayText = displayText ? `${displayText} ${tag}` : tag;
    }

    const badges = [];
    if (msg.isForwarded) badges.push('Forwarded');
    if (msg.isReply) badges.push('Reply');
    const badgeHtml = badges.length
      ? `<div class="message-badges">${badges.map(b => `<span class="badge">${escapeHTML(b)}</span>`).join('')}</div>`
      : '';

    return `
      <div class="message message-${side}"${dirAttr}>
        <div class="message-sender">${escapeHTML(msg.sender || 'Unknown')}</div>
        ${badgeHtml}
        <div class="message-text">${displayText}</div>
        <div class="message-time">${escapeHTML(msg.timestamp || '')}</div>
      </div>`;
  }).join('\n');

  const content = UTF8_BOM + `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHTML(info.contact)} — Chat Backup</title>
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
    <h1>${escapeHTML(info.contact)}</h1>
    <div class="meta">
      Exported: ${escapeHTML(exportDate)} &middot; ${info.messageCount} messages &middot; ${escapeHTML(info.chatType === 'group' ? 'Group chat' : 'Individual chat')}
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

  return new Blob([content], { type: 'text/html;charset=utf-8' });
}

export function generateFilename(chatName, exportDate, ext) {
  const date = formatExportDate(exportDate);
  const safe = sanitizeFileName(chatName);
  return `WhatsApp_Chat_${safe}_${date}.${ext}`;
}
