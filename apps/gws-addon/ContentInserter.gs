/**
 * ContentInserter — Inserts AI-generated content into Google Docs/Sheets/Slides.
 *
 * Called by the Chrome Extension via google.script.run (sidebar)
 * or directly from server-side triggers.
 */

// ─── GOOGLE DOCS ───────────────────────────────────────────────────────────

/**
 * Insert text at the current cursor position in Google Docs.
 */
function insertTextAtCursor(text) {
  var doc = DocumentApp.getActiveDocument();
  var cursor = doc.getCursor();

  if (cursor) {
    var element = cursor.getElement();
    var offset = cursor.getOffset();

    if (element.getType() === DocumentApp.ElementType.TEXT) {
      element.asText().insertText(offset, text);
    } else {
      // Cursor is at a non-text element — insert a new paragraph after it
      var parent = element.getParent();
      var index = parent.getChildIndex(element);
      parent.insertParagraph(index + 1, text);
    }
  } else {
    // No cursor — append to end of document
    doc.getBody().appendParagraph(text);
  }

  return { success: true, method: 'cursor_insert' };
}

/**
 * Insert text after a specific paragraph index (for Ghost Draft commits).
 */
function insertTextAfterParagraph(text, paragraphIndex) {
  var doc = DocumentApp.getActiveDocument();
  var body = doc.getBody();
  var numChildren = body.getNumChildren();

  if (paragraphIndex >= 0 && paragraphIndex < numChildren) {
    body.insertParagraph(paragraphIndex + 1, text);
    return { success: true, method: 'paragraph_insert', index: paragraphIndex + 1 };
  } else {
    body.appendParagraph(text);
    return { success: true, method: 'append' };
  }
}

/**
 * Replace a specific text range (for Highlight Revision accepts).
 */
function replaceTextRange(originalText, replacementText) {
  var doc = DocumentApp.getActiveDocument();
  var body = doc.getBody();
  var found = body.findText(escapeRegex_(originalText));

  if (found) {
    var element = found.getElement().asText();
    var start = found.getStartOffset();
    var end = found.getEndOffsetInclusive();
    element.deleteText(start, end);
    element.insertText(start, replacementText);
    return { success: true, method: 'text_replace' };
  }

  return { success: false, error: 'Original text not found in document' };
}

/**
 * Get the full document text (for AI context).
 */
function getDocumentContent() {
  var docType = detectDocType_();

  if (docType === 'docs') {
    var doc = DocumentApp.getActiveDocument();
    return {
      success: true,
      content: doc.getBody().getText(),
      title: doc.getName(),
      docType: 'docs',
    };
  } else if (docType === 'sheets') {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getActiveSheet();
    var range = sheet.getDataRange();
    var values = range.getValues();
    var text = values.map(function(row) { return row.join('\t'); }).join('\n');
    return {
      success: true,
      content: text,
      title: ss.getName(),
      docType: 'sheets',
    };
  } else {
    var pres = SlidesApp.getActivePresentation();
    var slides = pres.getSlides();
    var text = slides.map(function(slide, i) {
      var shapes = slide.getShapes();
      var slideText = shapes.map(function(shape) {
        return shape.getText().asString();
      }).join('\n');
      return 'Slide ' + (i + 1) + ':\n' + slideText;
    }).join('\n\n');
    return {
      success: true,
      content: text,
      title: pres.getName(),
      docType: 'slides',
    };
  }
}

// ─── GOOGLE SHEETS ─────────────────────────────────────────────────────────

/**
 * Insert value into a specific cell reference (e.g. "A1").
 */
function insertIntoCell(cellRef, value) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var range = sheet.getRange(cellRef);
  range.setValue(value);
  return { success: true, method: 'cell_insert', cell: cellRef };
}

/**
 * Insert into the currently selected cell.
 */
function insertIntoActiveCell(value) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var cell = sheet.getActiveCell();
  cell.setValue(value);
  return { success: true, method: 'active_cell_insert', cell: cell.getA1Notation() };
}

/**
 * Insert a formula into a specific cell.
 */
function insertFormulaIntoCell(cellRef, formula) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var range = sheet.getRange(cellRef);
  range.setFormula(formula);
  return { success: true, method: 'formula_insert', cell: cellRef };
}

// ─── GOOGLE SLIDES ─────────────────────────────────────────────────────────

/**
 * Insert text into speaker notes of a specific slide.
 */
function insertSpeakerNotes(slideIndex, text) {
  var pres = SlidesApp.getActivePresentation();
  var slides = pres.getSlides();

  if (slideIndex >= 0 && slideIndex < slides.length) {
    var slide = slides[slideIndex];
    var notesShape = slide.getNotesPage().getSpeakerNotesShape();
    var existing = notesShape.getText().asString();
    notesShape.getText().setText(
      existing ? existing + '\n\n' + text : text
    );
    return { success: true, method: 'speaker_notes', slide: slideIndex };
  }

  return { success: false, error: 'Invalid slide index' };
}

/**
 * Add a text box to a slide.
 */
function insertTextBoxOnSlide(slideIndex, text) {
  var pres = SlidesApp.getActivePresentation();
  var slides = pres.getSlides();

  if (slideIndex >= 0 && slideIndex < slides.length) {
    var slide = slides[slideIndex];
    // Center a 400x200 text box
    slide.insertTextBox(text, 80, 200, 400, 200);
    return { success: true, method: 'text_box', slide: slideIndex };
  }

  return { success: false, error: 'Invalid slide index' };
}

// ─── HELPERS ───────────────────────────────────────────────────────────────

function escapeRegex_(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
