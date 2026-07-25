/**
 * Follow — Smart Documents: Google Workspace Add-on
 *
 * Main entry point. Provides:
 * - onOpen / onInstall menu registration
 * - Sidebar launcher (Doc Mode)
 * - Homepage card for Add-on panel
 * - Provenance trigger bridge to Chrome Extension
 */

// ─── TRIGGERS ──────────────────────────────────────────────────────────────

function onOpen(e) {
  var ui = getUi_();
  if (!ui) return;

  ui.createMenu('Follow')
    .addItem('Open Doc Mode', 'showSidebar')
    .addItem('View Provenance', 'triggerProvenance')
    .addItem('Smart Document Settings', 'showSettings')
    .addSeparator()
    .addItem('Deactivate Follow', 'deactivateSmartDoc')
    .addToUi();
}

function onInstall(e) {
  onOpen(e);
}

function onFileScopeGranted(e) {
  return createHomepageCard();
}

function onDocsHomepage(e) { return createHomepageCard(); }
function onSheetsHomepage(e) { return createHomepageCard(); }
function onSlidesHomepage(e) { return createHomepageCard(); }

// ─── SIDEBAR ───────────────────────────────────────────────────────────────

function showSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Follow \u2014 Doc Mode')
    .setWidth(300);

  // Detect document type and pass context
  var docType = detectDocType_();
  html.append('<script>window.FOLLOW_DOC_TYPE="' + docType + '";</script>');

  var status = getSmartDocStatus();
  if (status.followDocId) {
    html.append('<script>window.FOLLOW_DOC_ID="' + status.followDocId + '";</script>');
  }
  if (status.strandId) {
    html.append('<script>window.FOLLOW_STRAND_ID="' + status.strandId + '";</script>');
  }

  var ui = getUi_();
  if (ui) ui.showSidebar(html);
}

function showSettings() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Follow \u2014 Settings')
    .setWidth(300);
  html.append('<script>window.FOLLOW_SIDEBAR_MODE="settings";</script>');

  var ui = getUi_();
  if (ui) ui.showSidebar(html);
}

function triggerProvenance() {
  // Set a property that the Chrome Extension polls to trigger provenance panel
  var props = PropertiesService.getDocumentProperties();
  props.setProperty('follow_action', 'open_provenance');
  props.setProperty('follow_action_ts', new Date().toISOString());
}

// ─── HOMEPAGE CARD (Add-on card interface) ─────────────────────────────────

function createHomepageCard() {
  var props = PropertiesService.getDocumentProperties();
  var isActive = props.getProperty('follow_enabled') === 'true';

  var builder = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader()
      .setTitle('Follow')
      .setSubtitle(isActive ? 'Smart Document Active' : 'Not Activated')
      .setImageUrl('https://follow.app/icon-48.png'));

  if (isActive) {
    var section = CardService.newCardSection()
      .addWidget(CardService.newDecoratedText()
        .setText('Recording')
        .setTopLabel('STATUS'))
      .addWidget(CardService.newDecoratedText()
        .setText(props.getProperty('follow_strand_name') || 'No strand')
        .setTopLabel('STRAND'))
      .addWidget(CardService.newTextButton()
        .setText('Open Doc Mode')
        .setOnClickAction(CardService.newAction().setFunctionName('showSidebar')));
    builder.addSection(section);
  } else {
    var section = CardService.newCardSection()
      .addWidget(CardService.newTextParagraph()
        .setText('Activate Follow to track provenance, get AI assistance, and build document intelligence.'))
      .addWidget(CardService.newTextButton()
        .setText('Activate Smart Document')
        .setOnClickAction(CardService.newAction().setFunctionName('activateFromAddon')));
    builder.addSection(section);
  }

  return builder.build();
}

// ─── HELPERS ───────────────────────────────────────────────────────────────

/**
 * Get the UI object for the active editor context.
 * Returns null if no editor is available (e.g. running from trigger).
 */
function getUi_() {
  try { return DocumentApp.getUi(); } catch (_) {}
  try { return SpreadsheetApp.getUi(); } catch (_) {}
  try { return SlidesApp.getUi(); } catch (_) {}
  return null;
}

/**
 * Detect which Google Workspace app context we're in.
 */
function detectDocType_() {
  try { DocumentApp.getActiveDocument(); return 'docs'; } catch (_) {}
  try { SpreadsheetApp.getActiveSpreadsheet(); return 'sheets'; } catch (_) {}
  try { SlidesApp.getActivePresentation(); return 'slides'; } catch (_) {}
  return 'docs';
}
