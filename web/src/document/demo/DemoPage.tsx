// The test page's content (separate from demo.tsx so fast refresh works).
import { useMemo, useState } from 'react'
import type { DocumentPayload } from '../../api'
import { GuidedReader } from '../index.ts'
import letter from './carta-renovacion.json'

export function DemoPage() {
  const [unclear, setUnclear] = useState(false)
  const doc = useMemo(() => {
    const d = structuredClone(letter) as DocumentPayload
    // Simulates a badly read line, to hear how unclear lines are announced.
    if (unclear) d.blocks = d.blocks.map((b) => (b.id === 'b11' ? { ...b, confidence: 0.4 } : b))
    return d
  }, [unclear])

  return (
    <main className="min-h-screen bg-slate-900 p-8 text-slate-50">
      <h1 className="mb-2 text-4xl font-bold">Guided reading — test page</h1>
      <label className="mb-4 flex items-center gap-3 text-xl">
        <input type="checkbox" checked={unclear} onChange={(e) => setUnclear(e.target.checked)} />
        Simulate an unclear line (line 11)
      </label>
      <GuidedReader doc={doc} />
    </main>
  )
}
