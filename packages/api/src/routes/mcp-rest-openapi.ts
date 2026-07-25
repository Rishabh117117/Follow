/**
 * OpenAPI 3.0 Spec Generator (Sprint DEPLOY-1)
 *
 * Serves an OpenAPI spec for the MCP REST wrapper endpoints.
 * ChatGPT imports this to discover available actions.
 */

import { Hono } from 'hono'
import { mcpTools } from '../mcp/tools/index'

export const mcpRestOpenApiRouter = new Hono()

mcpRestOpenApiRouter.get('/openapi.json', (c) => {
  const publicUrl = process.env['MCP_PUBLIC_URL'] ?? 'http://localhost:3001'

  const paths: Record<string, unknown> = {}

  for (const tool of mcpTools) {
    const routeName = tool.name.replace(/_/g, '-')
    const path = `/api/mcp-rest/${routeName}`

    // Convert MCP inputSchema to OpenAPI request body
    const schema = tool.inputSchema as Record<string, unknown>
    const properties = (schema.properties ?? {}) as Record<string, unknown>
    const required = (schema.required ?? []) as string[]

    paths[path] = {
      post: {
        operationId: tool.name,
        summary: tool.description,
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: required.length > 0,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties,
                required: required.length > 0 ? required : undefined,
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Tool result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'object',
                      properties: {
                        content: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              type: { type: 'string' },
                              text: { type: 'string' },
                            },
                          },
                        },
                      },
                    },
                    error: { type: 'object', nullable: true },
                  },
                },
              },
            },
          },
          '401': { description: 'Authentication required' },
          '500': { description: 'Tool execution error' },
        },
      },
    }
  }

  const spec = {
    openapi: '3.0.0',
    info: {
      title: 'Follow Index API',
      description: 'REST wrappers for Follow MCP tools. Query your personal knowledge index, share context across AI tools, and detect contradictions.',
      version: '1.0.0',
    },
    servers: [{ url: publicUrl }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Follow API key (wsp_*)',
        },
      },
    },
  }

  c.header('Access-Control-Allow-Origin', '*')
  return c.json(spec)
})
