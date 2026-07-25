import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { getDocState, loadDocState, getDocConnectionCount, getActiveDocNames } from '../yjs-server'

describe('Yjs Server Utilities', () => {
  describe('getDocState', () => {
    it('returns null for non-existent doc', () => {
      expect(getDocState('nonexistent-doc')).toBeNull()
    })
  })

  describe('loadDocState', () => {
    it('loads state into a document', () => {
      const sourceDoc = new Y.Doc()
      const text = sourceDoc.getText('content')
      text.insert(0, 'Hello, world!')
      const state = Y.encodeStateAsUpdate(sourceDoc)

      loadDocState('test-doc', state)

      const result = getDocState('test-doc')
      expect(result).not.toBeNull()

      // Verify the content was loaded
      const verifyDoc = new Y.Doc()
      Y.applyUpdate(verifyDoc, result!)
      expect(verifyDoc.getText('content').toString()).toBe('Hello, world!')

      sourceDoc.destroy()
      verifyDoc.destroy()
    })

    it('loads and merges multiple states', () => {
      const doc1 = new Y.Doc()
      doc1.getText('content').insert(0, 'Doc1 text')
      const state1 = Y.encodeStateAsUpdate(doc1)

      loadDocState('merge-test', state1)

      const doc2 = new Y.Doc()
      doc2.getMap('data').set('key', 'value')
      const state2 = Y.encodeStateAsUpdate(doc2)

      loadDocState('merge-test', state2)

      // The doc should have content from both states
      const result = getDocState('merge-test')
      expect(result).not.toBeNull()

      doc1.destroy()
      doc2.destroy()
    })
  })

  describe('getDocConnectionCount', () => {
    it('returns 0 for non-existent doc', () => {
      expect(getDocConnectionCount('no-such-doc')).toBe(0)
    })

    it('returns 0 for a doc with no connections', () => {
      // Load a doc to create it
      const doc = new Y.Doc()
      loadDocState('empty-conns', Y.encodeStateAsUpdate(doc))
      expect(getDocConnectionCount('empty-conns')).toBe(0)
      doc.destroy()
    })
  })

  describe('getActiveDocNames', () => {
    it('returns active document names', () => {
      // Load some docs
      const doc = new Y.Doc()
      const state = Y.encodeStateAsUpdate(doc)
      loadDocState('active-1', state)
      loadDocState('active-2', state)

      const names = getActiveDocNames()
      expect(names).toContain('active-1')
      expect(names).toContain('active-2')

      doc.destroy()
    })
  })
})
