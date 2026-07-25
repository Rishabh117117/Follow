# Follow — Google Workspace Add-on

Google Apps Script project providing the Doc Mode sidebar and content insertion for Google Docs, Sheets, and Slides.

## Setup

1. Install [clasp](https://github.com/google/clasp): `npm install -g @google/clasp`
2. Login: `clasp login`
3. Update `.clasp.json` with your Apps Script project ID
4. Push: `clasp push`

## Files

| File | Purpose |
|------|---------|
| `Code.gs` | Main entry: menu, sidebar launcher, homepage card |
| `PropertiesManager.gs` | PropertiesService wrapper for Smart Doc metadata + auth |
| `ContentInserter.gs` | Insert AI content into Docs/Sheets/Slides |
| `ServerFunctions.gs` | Sidebar → backend bridge (strands, doc intelligence, tensions) |
| `DocumentHelpers.gs` | Shared utilities across editor types |
| `Sidebar.html` | Doc Mode sidebar UI (inline CSS + JS) |

## Architecture

The Add-on communicates with the Follow backend via `UrlFetchApp.fetch()`.
Auth tokens are stored in `PropertiesService.getUserProperties()`.
The Chrome Extension and Add-on share state via the Follow backend (same strand, threads, document intelligence).
