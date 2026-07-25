/**
 * DocumentHelpers — Shared utilities for working with DocumentApp,
 * SpreadsheetApp, and SlidesApp.
 *
 * These functions provide a unified interface across the three editor types.
 */

/**
 * Get the Google file ID for the currently active document.
 */
function getActiveDocumentId() {
  var docType = detectDocType_();
  if (docType === 'docs') return DocumentApp.getActiveDocument().getId();
  if (docType === 'sheets') return SpreadsheetApp.getActiveSpreadsheet().getId();
  if (docType === 'slides') return SlidesApp.getActivePresentation().getId();
  return null;
}

/**
 * Get the title of the currently active document.
 */
function getActiveDocumentTitle() {
  var docType = detectDocType_();
  if (docType === 'docs') return DocumentApp.getActiveDocument().getName();
  if (docType === 'sheets') return SpreadsheetApp.getActiveSpreadsheet().getName();
  if (docType === 'slides') return SlidesApp.getActivePresentation().getName();
  return 'Untitled';
}

/**
 * Get the URL of the currently active document.
 */
function getActiveDocumentUrl() {
  var docType = detectDocType_();
  if (docType === 'docs') return DocumentApp.getActiveDocument().getUrl();
  if (docType === 'sheets') return SpreadsheetApp.getActiveSpreadsheet().getUrl();
  if (docType === 'slides') return SlidesApp.getActivePresentation().getUrl();
  return '';
}

/**
 * Get a summary of the document structure.
 * Used by the sidebar to display outline / structure info.
 */
function getDocumentStructure() {
  var docType = detectDocType_();

  if (docType === 'docs') {
    var doc = DocumentApp.getActiveDocument();
    var body = doc.getBody();
    var numChildren = body.getNumChildren();
    var headings = [];

    for (var i = 0; i < numChildren; i++) {
      var child = body.getChild(i);
      if (child.getType() === DocumentApp.ElementType.PARAGRAPH) {
        var para = child.asParagraph();
        var heading = para.getHeading();
        if (heading !== DocumentApp.ParagraphHeading.NORMAL) {
          headings.push({
            index: i,
            text: para.getText(),
            level: heading.toString().replace('HEADING', 'H'),
          });
        }
      }
    }

    return {
      docType: 'docs',
      title: doc.getName(),
      paragraphCount: numChildren,
      headings: headings,
      wordCount: body.getText().split(/\s+/).length,
    };
  }

  if (docType === 'sheets') {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheets = ss.getSheets();

    return {
      docType: 'sheets',
      title: ss.getName(),
      sheetCount: sheets.length,
      sheets: sheets.map(function(sheet) {
        return {
          name: sheet.getName(),
          rows: sheet.getLastRow(),
          cols: sheet.getLastColumn(),
        };
      }),
    };
  }

  if (docType === 'slides') {
    var pres = SlidesApp.getActivePresentation();
    var slides = pres.getSlides();

    return {
      docType: 'slides',
      title: pres.getName(),
      slideCount: slides.length,
      slides: slides.map(function(slide, i) {
        var shapes = slide.getShapes();
        var textPreview = '';
        if (shapes.length > 0) {
          textPreview = shapes[0].getText().asString().substring(0, 60);
        }
        return { index: i, preview: textPreview };
      }),
    };
  }

  return { docType: 'unknown' };
}

/**
 * Get cursor position info in Google Docs.
 */
function getCursorPosition() {
  try {
    var doc = DocumentApp.getActiveDocument();
    var cursor = doc.getCursor();
    if (!cursor) return null;

    var element = cursor.getElement();
    var offset = cursor.getOffset();
    var parent = element.getParent();
    var paragraphIndex = parent.getParent()
      ? parent.getParent().getChildIndex(parent)
      : 0;

    return {
      paragraphIndex: paragraphIndex,
      offset: offset,
      text: element.asText ? element.asText().getText().substring(
        Math.max(0, offset - 20),
        Math.min(element.asText().getText().length, offset + 20)
      ) : '',
    };
  } catch (_) {
    return null;
  }
}
