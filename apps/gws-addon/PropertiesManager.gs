/**
 * PropertiesManager — manages Follow metadata stored on the document
 * via PropertiesService.
 *
 * Document-level properties persist with the file and are visible
 * to all users who open the document.
 * User-level properties store the auth token and workspace ID.
 */

// ─── READ STATUS ───────────────────────────────────────────────────────────

function getSmartDocStatus() {
  var props = PropertiesService.getDocumentProperties();
  return {
    enabled: props.getProperty('follow_enabled') === 'true',
    followDocId: props.getProperty('follow_doc_id'),
    strandId: props.getProperty('follow_strand_id'),
    strandName: props.getProperty('follow_strand_name'),
    workspaceId: props.getProperty('follow_workspace_id'),
    activatedAt: props.getProperty('follow_activated_at'),
    lastSyncRevision: props.getProperty('follow_last_sync_revision'),
  };
}

// ─── WRITE STATUS ──────────────────────────────────────────────────────────

function setSmartDocProperties(followDocId, strandId, strandName, workspaceId) {
  var props = PropertiesService.getDocumentProperties();
  props.setProperties({
    'follow_enabled': 'true',
    'follow_doc_id': followDocId,
    'follow_strand_id': strandId || '',
    'follow_strand_name': strandName || '',
    'follow_workspace_id': workspaceId,
    'follow_activated_at': new Date().toISOString(),
  });
}

function clearSmartDocProperties() {
  var props = PropertiesService.getDocumentProperties();
  props.deleteAllProperties();
}

// ─── ACTIVATION ────────────────────────────────────────────────────────────

function activateFromAddon() {
  var docType = detectDocType_();
  var docId, title;

  if (docType === 'docs') {
    var doc = DocumentApp.getActiveDocument();
    docId = doc.getId();
    title = doc.getName();
  } else if (docType === 'sheets') {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    docId = ss.getId();
    title = ss.getName();
  } else {
    var pres = SlidesApp.getActivePresentation();
    docId = pres.getId();
    title = pres.getName();
  }

  var workspaceId = getStoredWorkspaceId_();
  if (!workspaceId) {
    var ui = getUi_();
    if (ui) {
      ui.alert('Please sign in to Follow first using the Chrome Extension popup.');
    }
    return;
  }

  var token = getStoredToken_();
  if (!token) {
    var ui = getUi_();
    if (ui) {
      ui.alert('No auth token found. Please sign in via the Chrome Extension popup.');
    }
    return;
  }

  try {
    var response = UrlFetchApp.fetch(FOLLOW_API_BASE + '/api/gws/documents', {
      method: 'POST',
      contentType: 'application/json',
      headers: {
        'Authorization': 'Bearer ' + token,
        'x-user-id': getStoredUserId_(),
        'x-workspace-id': workspaceId,
      },
      payload: JSON.stringify({
        externalDocId: docId,
        docType: 'google_' + docType,
        title: title,
        workspaceId: workspaceId,
      }),
    });

    var data = JSON.parse(response.getContentText());
    if (data.data) {
      setSmartDocProperties(data.data.id, data.data.strandId, '', data.data.workspaceId);
    }
  } catch (e) {
    Logger.log('Activation failed: ' + e.message);
    var ui = getUi_();
    if (ui) ui.alert('Failed to activate: ' + e.message);
  }
}

function deactivateSmartDoc() {
  var ui = getUi_();
  if (!ui) return;

  var result = ui.alert(
    'Deactivate Follow',
    'This will stop tracking provenance for this document. Existing data is preserved.',
    ui.ButtonSet.YES_NO
  );

  if (result === ui.Button.YES) {
    var props = PropertiesService.getDocumentProperties();
    var followDocId = props.getProperty('follow_doc_id');

    if (followDocId) {
      try {
        UrlFetchApp.fetch(FOLLOW_API_BASE + '/api/gws/documents/' + followDocId, {
          method: 'DELETE',
          headers: {
            'Authorization': 'Bearer ' + getStoredToken_(),
            'x-user-id': getStoredUserId_(),
            'x-workspace-id': getStoredWorkspaceId_(),
          },
        });
      } catch (e) {
        Logger.log('Deactivation API call failed: ' + e.message);
      }
    }
    clearSmartDocProperties();
  }
}

// ─── AUTH TOKEN STORAGE (user-level properties) ────────────────────────────

function getStoredToken_() {
  return PropertiesService.getUserProperties().getProperty('follow_auth_token') || '';
}

function getStoredUserId_() {
  return PropertiesService.getUserProperties().getProperty('follow_user_id') || '';
}

function getStoredWorkspaceId_() {
  return PropertiesService.getUserProperties().getProperty('follow_workspace_id') || '';
}

function storeAuthCredentials(token, userId, workspaceId) {
  var userProps = PropertiesService.getUserProperties();
  userProps.setProperties({
    'follow_auth_token': token,
    'follow_user_id': userId,
    'follow_workspace_id': workspaceId,
  });
}

// ─── API BASE URL ──────────────────────────────────────────────────────────

var FOLLOW_API_BASE = PropertiesService.getUserProperties
  ? (function() {
      try {
        return PropertiesService.getUserProperties().getProperty('follow_api_base') || 'http://localhost:3001';
      } catch (_) {
        return 'http://localhost:3001';
      }
    })()
  : 'http://localhost:3001';
