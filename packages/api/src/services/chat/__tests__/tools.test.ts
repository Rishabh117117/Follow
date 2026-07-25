import { describe, it, expect } from 'vitest'
import { getToolDefinitions } from '../tools'

describe('Chat Tools', () => {
  describe('getToolDefinitions', () => {
    it('should return an array of tool definitions', () => {
      const tools = getToolDefinitions('test-workspace')
      expect(Array.isArray(tools)).toBe(true)
      expect(tools.length).toBeGreaterThan(0)
    })

    it('should have required fields on each tool', () => {
      const tools = getToolDefinitions('test-workspace')
      for (const tool of tools) {
        expect(tool).toHaveProperty('name')
        expect(tool).toHaveProperty('description')
        expect(tool).toHaveProperty('input_schema')
        expect(typeof tool.name).toBe('string')
        expect(typeof tool.description).toBe('string')
      }
    })

    it('should include search_files tool', () => {
      const tools = getToolDefinitions('test-workspace')
      const searchTool = tools.find((t) => t.name === 'search_files')
      expect(searchTool).toBeDefined()
      expect(searchTool!.input_schema.properties).toHaveProperty('query')
    })

    it('should include read_file tool', () => {
      const tools = getToolDefinitions('test-workspace')
      const readTool = tools.find((t) => t.name === 'read_file')
      expect(readTool).toBeDefined()
      expect(readTool!.input_schema.properties).toHaveProperty('fileId')
    })

    it('should include create_file tool', () => {
      const tools = getToolDefinitions('test-workspace')
      const createTool = tools.find((t) => t.name === 'create_file')
      expect(createTool).toBeDefined()
      expect(createTool!.input_schema.properties).toHaveProperty('name')
      expect(createTool!.input_schema.properties).toHaveProperty('content')
    })

    it('should include list_files tool', () => {
      const tools = getToolDefinitions('test-workspace')
      const listTool = tools.find((t) => t.name === 'list_files')
      expect(listTool).toBeDefined()
    })

    it('should include get_timeline_summary tool', () => {
      const tools = getToolDefinitions('test-workspace')
      const timelineTool = tools.find((t) => t.name === 'get_timeline_summary')
      expect(timelineTool).toBeDefined()
    })

    it('should include read_canvas tool', () => {
      const tools = getToolDefinitions('test-workspace')
      const canvasTool = tools.find((t) => t.name === 'read_canvas')
      expect(canvasTool).toBeDefined()
    })

    it('should include get_realtime_activity tool', () => {
      const tools = getToolDefinitions('test-workspace')
      const realtimeTool = tools.find((t) => t.name === 'get_realtime_activity')
      expect(realtimeTool).toBeDefined()
      expect(realtimeTool!.description).toContain('real-time activity')
      expect(realtimeTool!.input_schema.properties).toHaveProperty('lookbackMinutes')
      expect(realtimeTool!.input_schema.properties).toHaveProperty('includeHeartbeats')
      expect(realtimeTool!.input_schema.properties).toHaveProperty('limit')
    })

    it('should have valid JSON schema for input_schema', () => {
      const tools = getToolDefinitions('test-workspace')
      for (const tool of tools) {
        expect(tool.input_schema.type).toBe('object')
        expect(tool.input_schema).toHaveProperty('properties')
        expect(tool.input_schema).toHaveProperty('required')
        expect(Array.isArray(tool.input_schema.required)).toBe(true)
      }
    })
  })
})
