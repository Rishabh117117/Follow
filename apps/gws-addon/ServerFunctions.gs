/**
 * ServerFunctions — Functions callable from the sidebar via google.script.run
 *
 * These bridge the sidebar UI to the Follow backend, using the stored
 * auth token and workspace ID.
 */

/**
 * Fetch strands available for this document's workspace.
 */
function getStrandsForDocument() {
  var props = PropertiesService.getDocumentProperties();
  var workspaceId = props.getProperty('follow_workspace_id');
  var activeStrandId = props.getProperty('follow_strand_id');

  if (!workspaceId) return [];

  var token = getStoredToken_();
  if (!token) return [];

  try {
    var response = UrlFetchApp.fetch(
      FOLLOW_API_BASE + '/api/strands?workspaceId=' + workspaceId,
      {
        headers: {
          'Authorization': 'Bearer ' + token,
          'x-user-id': getStoredUserId_(),
          'x-workspace-id': workspaceId,
        },
      }
    );
    var data = JSON.parse(response.getContentText());
    return (data.data || []).map(function(s) {
      return { id: s.id, name: s.name, isActive: s.id === activeStrandId };
    });
  } catch (e) {
    Logger.log('Failed to fetch strands: ' + e.message);
    return [];
  }
}

/**
 * Fetch document intelligence (phase, intent) from doc memory endpoint.
 */
function getDocumentIntelligence() {
  var props = PropertiesService.getDocumentProperties();
  var followDocId = props.getProperty('follow_doc_id');
  if (!followDocId) return null;

  var workspaceId = props.getProperty('follow_workspace_id');

  try {
    var response = UrlFetchApp.fetch(
      FOLLOW_API_BASE + '/api/doc-memory/' + followDocId,
      {
        headers: {
          'Authorization': 'Bearer ' + getStoredToken_(),
          'x-user-id': getStoredUserId_(),
          'x-workspace-id': workspaceId || '',
        },
      }
    );
    var data = JSON.parse(response.getContentText());
    var interp = data.data;
    return interp ? { phase: interp.narrativePhase, intent: interp.workingIntent } : null;
  } catch (e) {
    Logger.log('Failed to fetch doc intelligence: ' + e.message);
    return null;
  }
}

/**
 * Fetch active tensions from document memory.
 */
function getActiveTensions() {
  var props = PropertiesService.getDocumentProperties();
  var followDocId = props.getProperty('follow_doc_id');
  if (!followDocId) return [];

  var workspaceId = props.getProperty('follow_workspace_id');

  try {
    var response = UrlFetchApp.fetch(
      FOLLOW_API_BASE + '/api/doc-memory/' + followDocId,
      {
        headers: {
          'Authorization': 'Bearer ' + getStoredToken_(),
          'x-user-id': getStoredUserId_(),
          'x-workspace-id': workspaceId || '',
        },
      }
    );
    var data = JSON.parse(response.getContentText());
    return (data.data && data.data.activeTensions) || [];
  } catch (e) {
    Logger.log('Failed to fetch tensions: ' + e.message);
    return [];
  }
}

/**
 * Update the strand association for this document.
 */
function updateStrandAssociation(strandId) {
  var props = PropertiesService.getDocumentProperties();
  var followDocId = props.getProperty('follow_doc_id');
  var workspaceId = props.getProperty('follow_workspace_id');
  if (!followDocId) return;

  try {
    UrlFetchApp.fetch(
      FOLLOW_API_BASE + '/api/gws/documents/' + followDocId + '/strand',
      {
        method: 'PATCH',
        contentType: 'application/json',
        headers: {
          'Authorization': 'Bearer ' + getStoredToken_(),
          'x-user-id': getStoredUserId_(),
          'x-workspace-id': workspaceId || '',
        },
        payload: JSON.stringify({ strandId: strandId }),
      }
    );
    props.setProperty('follow_strand_id', strandId);
  } catch (e) {
    Logger.log('Failed to update strand: ' + e.message);
  }
}

/**
 * Generic action trigger — sets a property that the Chrome Extension polls.
 */
function triggerAction(action) {
  var props = PropertiesService.getDocumentProperties();
  props.setProperty('follow_action', action);
  props.setProperty('follow_action_ts', new Date().toISOString());
}
