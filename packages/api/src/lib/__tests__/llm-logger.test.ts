/* eslint-disable @typescript-eslint/no-explicit-any -- mock-heavy test file */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const insertedRows: Array<any> = []

vi.mock('../../db/index', () => ({
  db: {
    insert: () => ({
      values: (v: any) => {
        insertedRows.push(v)
        return Promise.resolve()
      },
    }),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ total: 0 }]),
      }),
    }),
  },
}))

vi.mock('../../db/schema/llm-usage', () => ({
  llmUsage: {
    userId: 'userId',
    model: 'model',
    costUsd: 'costUsd',
    inputTokens: 'inputTokens',
    outputTokens: 'outputTokens',
    createdAt: 'createdAt',
  },
}))

import { logLLMUsage, calculateCost, startOfToday, startOfMonth } from '../llm-logger'

describe('LLM Logger (WIRE-1)', () => {
  beforeEach(() => {
    insertedRows.length = 0
    vi.clearAllMocks()
  })

  it('logLLMUsage inserts row with correct model and tokens', async () => {
    await logLLMUsage({
      userId: 'user-1',
      model: 'gemini-2.5-flash',
      modelTier: 'CHAT_AGENT',
      inputTokens: 1000,
      outputTokens: 500,
      source: 'chat',
    })
    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0].model).toBe('gemini-2.5-flash')
    expect(insertedRows[0].inputTokens).toBe(1000)
    expect(insertedRows[0].outputTokens).toBe(500)
    expect(insertedRows[0].source).toBe('chat')
  })

  it('logLLMUsage computes costUsd before insert', async () => {
    await logLLMUsage({
      userId: 'user-1',
      model: 'gemini-2.5-flash',
      modelTier: 'CHAT_AGENT',
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      source: 'chat',
    })
    // gemini-2.5-flash: $0.30/M input + $2.50/M output → 1M in + 0.5M out =
    // $0.30 + $1.25 = $1.55 (pricing table updated to Google's current rates)
    expect(insertedRows[0].costUsd).toBeCloseTo(1.55, 4)
  })

  it('calculateCost returns correct value for Gemini Flash', () => {
    // 1M input + 1M output = $0.30 + $2.50 = $2.80
    expect(calculateCost('gemini-2.5-flash', 1_000_000, 1_000_000)).toBeCloseTo(2.8, 4)
  })

  it('calculateCost returns correct value for DeepSeek v3', () => {
    // 1M input + 1M output = $0.27 + $1.10 = $1.37
    expect(calculateCost('deepseek-v3', 1_000_000, 1_000_000)).toBeCloseTo(1.37, 4)
  })

  it('calculateCost returns 0 for unknown model', () => {
    expect(calculateCost('totally-unknown-model-xyz', 1000, 1000)).toBe(0)
  })

  it('calculateCost handles embedding models (input only)', () => {
    // text-embedding-3-small: $0.02/M input, $0/output
    expect(calculateCost('text-embedding-3-small', 1_000_000, 0)).toBeCloseTo(0.02, 4)
  })

  it('logLLMUsage does not throw on DB errors', async () => {
    // Should never bubble errors (non-blocking)
    await expect(
      logLLMUsage({
        userId: 'user-1',
        model: 'gemini-2.5-flash',
        modelTier: 'CHAT_AGENT',
        inputTokens: 100,
        outputTokens: 50,
        source: 'test',
      })
    ).resolves.toBeUndefined()
  })

  it('startOfToday returns midnight today', () => {
    const t = startOfToday()
    expect(t.getHours()).toBe(0)
    expect(t.getMinutes()).toBe(0)
    expect(t.getSeconds()).toBe(0)
  })

  it('startOfMonth returns day 1 midnight', () => {
    const m = startOfMonth()
    expect(m.getDate()).toBe(1)
    expect(m.getHours()).toBe(0)
  })
})
