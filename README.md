# JARVIS — your personal browser

A Windows desktop browser with real Chromium tabs and a JARVIS-inspired companion. Open **Launch JARVIS.cmd** in this folder to start it. The portable build, when packaged, is **release/Jarvis-win32-x64/Jarvis.exe**. The packaged app creates a **JARVIS** Start menu shortcut on first launch, so it can be found by typing JARVIS into Windows Search.

## Start here

1. Type a website, such as `youtube.com`, into the bar at the top and press Enter. Type `jarvis` to return home. Common websites and recent pages also appear on Home and in the address suggestions.
2. Select **How to use JARVIS** on the left whenever you want a guide. Type **new tab** in the assistant; browser commands work immediately. Tabs are across the top, above the address bar.
3. Select **School library → Choose folder** and choose a folder synced by your cloud app (OneDrive, Google Drive, Dropbox, etc.). JARVIS does not create a cloud account or verify upload status.
4. Choose **Add documents**. PDF, Word (.docx), TXT, Markdown and CSV files are supported, up to 20 MB each and 20 per batch. JARVIS extracts text and asks your connected free AI for a subject, topic and summary. Review or edit the suggestions, then choose **Save to folder**. Copies go under **JARVIS School / Subject / Topic**; originals remain in place and duplicate filenames are never overwritten. Scanned PDFs need OCR first and can be filed manually. Without AI, manual filing still works.
5. To teach JARVIS from your routine, open **Train my JARVIS**, connect the free AI, and choose **Start learning**. The bottom popup shows each temporary desktop preview, the model route, and the high-level note that was saved. Pause from the popup or press the in-app **Emergency stop** button at any time.

## What works

- Real websites in isolated tabs, with an address/search bar, back, forward, refresh, and page error recovery.
- Bookmarks, browsing history, download progress, and saved tabs.
- A calm home screen with a personalised welcome, rounded surfaces, top tabs, quick links and a new JARVIS monogram.
- Address-bar and Home suggestions for common sites, bookmarks, recent pages, and a direct search option; Home also shows a compact recently visited strip.
- A school library with AI subject/topic suggestions, editable review cards, a selectable cloud sync folder, searchable saved records, and folder reveal. The public feature-builder links and Things to try sections have been removed; existing installed tools are retained.
- Built-in commands: `open YouTube`, `search for nebulae`, `new tab`, `go back`, `go home`, `refresh`, and `bookmark this page`.
- OpenRouter free-model conversations, optional summaries of the current page, and suggested links you choose to open.
- Whole-desktop learning sessions that save only high-level routine summaries. Raw screen previews stay in memory until the next capture and are never written to the profile.
- Optional spoken replies using a local system voice. Microphone transcription is unavailable with the free connection.
- Name, search engine, model, animation, and speech preferences.

## AI connection

The AI integration uses OpenRouter’s free-model router. Choose **Settings → Connect free AI**, sign in to OpenRouter in the secure browser page, and approve the connection. JARVIS stores the connection encrypted on this computer and uses `openrouter/free` with a zero price ceiling, so it never silently switches to a paid model. Free models have daily limits and can be busy or unavailable. Built-in browser commands and starter tools work without AI. Windows voice typing (`Win + H`) works in the message box.

Requests are sent from the main process to OpenRouter, and no connection credential is exposed to website renderers or the app UI. The last 80 chat messages are saved locally and restored on restart; New conversation clears them. Page text is shared only when you choose **Include this page** or **Summarize this page**; form controls are excluded. Adding school documents sends up to 14,000 extracted characters from each document to the connected free AI. PDFs are read up to the first 60 pages. Raw extracted text is not saved in the library index. OpenRouter’s free router selects from currently available free models; free usage limits and availability can change.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl L | Address bar |
| Ctrl T / Ctrl W | New tab / close tab |
| Alt Left / Alt Right | Back / forward |
| Ctrl R / F5 | Reload |
| Ctrl D | Bookmark the current page |
| Ctrl K | Focus JARVIS |
| Ctrl F | Find on the page |
| Ctrl H | History |
| Ctrl + Shift + Esc | Emergency stop (in the browser; Windows may reserve this shortcut) |
| F11 | Full screen |
| Enter / Shift Enter | Send message / new line |

## Development

Use Node.js 22.12 or newer (Node.js 24 recommended).

```text
npm install
npm start
npm test
npm run test:browser
npm run package
```

The automated browser test uses a temporary local fixture and a separate test profile. It verifies navigation, bookmarks, settings, tab controls, remote renderer isolation, page extraction, blocked unsafe navigation, missing-key behavior, the guide, and saving/reopening a tool. API behavior is unit-tested with simulated responses; browser tests ignore real credentials and make no billable API requests. Screenshots are saved in `artifacts`.

Your development profile is stored in the ignored `.jarvis-profile` folder. A packaged copy stores its profile in the Windows application data directory. Do not publish personal profiles or key files. Packaging excludes them.

## Current limits

This is a first working personal browser, not a replacement for the security maintenance, extension ecosystem, password manager, DRM playback, and update service of a mainstream browser. Some services restrict embedded Chromium sign-in or protected media. The app does not perform autonomous clicks, send messages, make purchases, or control your computer. Suggested AI browsing actions require a click. There is no built-in live AI web search; a suggested search opens the chosen search engine. Downloads use Chromium’s save dialog and are listed for the current session.

## Implementation references

- [Electron WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)
- [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)
- [OpenRouter free models](https://openrouter.ai/docs/guides/routing/routers/free-router)
- [OpenRouter OAuth PKCE](https://openrouter.ai/docs/guides/overview/auth/oauth)
