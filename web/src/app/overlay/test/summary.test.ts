import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { DocumentPayload } from '../../../api/index.ts'
import { costLine, documentText, type SummaryResult } from '../summary.ts'

const block = (id: string, text: string, y: number, x = 0.1) => ({
  id,
  text,
  box: { x, y, w: 0.5, h: 0.05 },
  confidence: 0.9,
})

test('summary: the document text goes in reading order, without empty lines', () => {
  const doc: DocumentPayload = {
    blocks: [block('b', 'Second line', 0.3), block('a', 'First line', 0.1), block('c', '   ', 0.5)],
    quality: { score: 1, issues: [] },
  }
  assert.equal(documentText(doc), 'First line\nSecond line')
  assert.equal(documentText(null), '')
})

test('summary: the cost line shows cost, time, tokens and model', () => {
  const r = {
    costUsd: 0.000312,
    latencyMs: 1830,
    promptTokens: 900,
    completionTokens: 120,
    escalated: false,
    cached: false,
    model: 'anthropic/claude-haiku-5.5',
  } as SummaryResult
  assert.equal(costLine(r), '0.00031 $ · 1.8 s · 1020 tokens · cheap model (anthropic/claude-haiku-5.5)')
  assert.match(costLine({ ...r, cached: true, escalated: true }), /^cached: 0 \$ .* expensive model/)
})
