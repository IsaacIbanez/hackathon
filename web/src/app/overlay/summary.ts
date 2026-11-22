// Summaries with AI (task N7, brief docs/briefs/N7.md): pure helpers for SummaryPanel.tsx, tested
// without a browser. The model call is the Go binding Summarize (app_summary.go).
import type { DocumentPayload } from '../../api'
import { readingOrder } from '../../document/reader.ts'

/** What the Go binding returns (session.Summary plus totals). */
export interface SummaryResult {
  summary: string
  actions: string[]
  speech: string
  lang: string
  truncated: boolean
  model: string
  tier: string
  escalated: boolean
  cached: boolean
  costUsd: number
  latencyMs: number
  promptTokens: number
  completionTokens: number
  totalCostUsd: number
  /** Set when there is no summary: a sentence to read aloud. */
  error?: string
}

/** The document's text in reading order, one line per block. */
export function documentText(doc: DocumentPayload | null): string {
  return readingOrder(doc)
    .map((l) => l.text.trim())
    .filter(Boolean)
    .join('\n')
}

/** One line with what the summary cost, for the screen ("0.00031 $ · 1.8 s · cheap model …"). */
export function costLine(r: SummaryResult): string {
  const parts = [
    r.cached ? 'cached: 0 $' : `${r.costUsd.toFixed(5)} $`,
    `${(r.latencyMs / 1000).toFixed(1)} s`,
    `${r.promptTokens + r.completionTokens} tokens`,
    `${r.escalated ? 'expensive' : 'cheap'} model${r.model ? ` (${r.model})` : ''}`,
  ]
  return parts.join(' · ')
}
