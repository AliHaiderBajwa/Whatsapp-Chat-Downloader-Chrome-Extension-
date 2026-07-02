<div align="center">

# 💬 WhatsApp Chat Backup
### Chrome Extension — Export WhatsApp Web Chats to JSON, TXT, or HTML

![Chrome MV3](https://img.shields.io/badge/Manifest-V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![HTML/CSS](https://img.shields.io/badge/HTML-CSS-1572B6?style=for-the-badge&logo=html5&logoColor=white)
![Status](https://img.shields.io/badge/Status-Complete-brightgreen?style=for-the-badge)

*Scrapes the active WhatsApp Web chat via DOM parsing, auto-loads older messages through smart scrolling, and downloads the full conversation in your choice of format — all client-side, no servers involved.*

</div>

---

## 📌 Overview

WhatsApp Chat Backup is a **Manifest V3 Chrome extension** that extracts message history from [web.whatsapp.com](https://web.whatsapp.com/) by parsing the live DOM. It navigates through chat messages, detects senders, timestamps, media attachments, and text formatting, then packages everything into a downloadable file.

The extension operates entirely in the browser — no data is sent to any external server. Every export is generated locally via the service worker and saved through the Chrome Downloads API.

---

## ✨ Features

- **Deep-scroll scraping** — Automatically scrolls up the chat to load older messages (up to 10,000), with deduplication and stall detection
- **3 export formats** — JSON (structured data / analysis), TXT (readable plain text), HTML (WhatsApp-dark-themed, responsive, with light mode & print CSS)
- **Filter before export** — Search by keyword, filter by date range (24h / 7d / 30d), or show media-only messages
- **Message preview** — See the first 10 scraped messages in the popup before downloading
- **Floating backup button** — A persistent "Backup Chat" FAB injected on WhatsApp Web for one-click access
- **Media metadata** — Detects images, videos, audio, documents, stickers, and GIFs with filename, size, duration, and MIME type
- **Formatting preservation** — Bold (`*text*`), italic (`_text_`), strikethrough (`~text~`), inline code, and blockquotes are parsed and rendered in exports
- **RTL language support** — Automatic text direction detection for Arabic, Hebrew, Urdu, and other RTL scripts
- **Progress reporting** — Live message count during deep-scrape with a shimmer-animated progress bar
- **Cancellation & timeout** — Cancel in-progress backups or let the 2-minute timeout handle stalls
- **Session history** — Stores the last 5 backup sessions with status, chat name, and timestamp
- **Persistent preferences** — Remembers your last-used export format across sessions
- **No backend required** — Everything runs inside the browser; zero external dependencies

---

## 📸 Screenshots

| Popup Interface | Message Preview | Floating Button | HTML Export |
|:---:|:---:|:---:|:---:|
| ![Popup](images/screenshot-popup.png) | ![Preview](images/screenshot-preview.png) | ![Floating Button](images/screenshot-float.png) | ![HTML Export](images/screenshot-html.png) |

---

## 📂 Repository Structure

```
whatsapp-chat-backup/
├── manifest.json              # Extension manifest (Manifest V3)
├── popup/
│   ├── popup.html             # Popup UI (status, format selector, filters, preview)
│   ├── popup.css              # Popup styles (WhatsApp dark theme, light mode support)
│   └── popup.js               # Popup logic (state machine, polling, event handling)
├── content/
│   ├── content.js             # WhatsApp Web DOM scraper (message extraction, deep-scroll)
│   └── content.css            # Injected styles (floating button, toast notifications)
├── background/
│   └── background.js          # Service worker (session management, message routing, export generation)
├── utils/
│   ├── formatters.js          # Timestamp, text, HTML formatting utilities
│   └── exporters.js           # JSON / TXT / HTML export builders
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   ├── icon128.png
│   └── generate-icons.ps1     # PowerShell icon generator
├── images/                    # (add screenshots here)
└── README.md
```

---

## ⚙️ Installation

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Browse to and select the project root folder
5. The extension icon appears in the toolbar — pin it for easy access

---

## 🚀 Usage

1. Go to [web.whatsapp.com](https://web.whatsapp.com/) and scan the QR code to log in
2. Open any chat (individual or group)
3. Click the extension icon in the toolbar
4. Verify the chat name appears and the status shows **Ready**
5. *(Optional)* Scroll up in the chat manually to load older messages first
6. Select your export format: **JSON** / **Plain Text** / **HTML**
7. Click **Start Backup**
8. Watch the progress bar as the extension deep-scrolls and collects messages
9. *(Optional)* Use the **search**, **date filter**, or **media-only** toggle to narrow down the export
10. Click **Download** to save the file

> **Tip:** You can also click the floating **⬇ Backup Chat** button that appears on WhatsApp Web for a quicker workflow (exports to JSON by default).

---

## 🔧 Technical Details

| Component | Description |
|---|---|
| **DOM Scraping** | Parses `.message-in` / `.message-out` elements to extract sender, timestamp, text, and media |
| **Deep-Scroll Engine** | Auto-scrolls the chat container by 70% of its height, waits for DOM stabilization, deduplicates by `data-id` |
| **Mutation Observer** | Watches the chat list container for dynamic content changes |
| **Export Pipeline** | Content script collects → Background formats → Chrome Downloads API saves |
| **State Machine** | Popup uses 8 states (Connecting → Idle → Ready → Backing up → Complete / Error / Cancelled) |
| **Media Classification** | Checks for `img`, `audio`, `video`, `[data-testid="media-doc"]`, and aria-labels to detect 6 media types |
| **RTL Detection** | Unicode range regex for automatic text direction |
| **Format Parsing** | Regex-based extraction of bold (`*`), italic (`_`), strikethrough (`~`), code (`` ` ``), and quotes (`>`) |

---

## 🔐 Permissions

| Permission | Justification |
|---|---|
| `activeTab` | Access the currently active WhatsApp Web tab |
| `scripting` | Inject content scripts on demand for scraping |
| `storage` | Save user preferences and backup session history |
| `downloads` | Download exported chat files to the user's machine |
| `alarms` | 2-minute timeout guard for stalled scrapes |
| `https://web.whatsapp.com/*` | Host permission required to interact with WhatsApp Web |

---

## 📄 License

Feel free to use, modify, and learn from this. Credit appreciated but not required.
