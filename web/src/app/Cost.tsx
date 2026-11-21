import type { StatsPayload, TierStats } from '../api'

// Cost and latency meter (frugality, AXA criterion). Deliberately no aria-live:
// it changes after every call and reading it aloud each time would be annoying.

const usd = (n: number) => `$${n.toFixed(4)}`

function Tier({ name, s }: { name: string; s: TierStats }) {
  return (
    <div>
      <dt className="font-semibold">{name}</dt>
      <dd>
        {s.calls} calls · {s.cacheHits} cached · {usd(s.costUsd)}
        {s.calls > 0 && <> · {s.avgLatencyMs} ms avg</>}
        {s.errors > 0 && <> · {s.errors} errors</>}
      </dd>
    </div>
  )
}

export function Cost({ stats }: { stats: StatsPayload | null }) {
  if (!stats) return null
  return (
    <aside aria-label="AI cost" className="mt-8 rounded-xl border border-slate-700 p-4 text-lg">
      <p className="text-2xl">
        AI cost: <strong>{usd(stats.totalCostUsd)}</strong>
      </p>
      <dl className="mt-2 space-y-1 text-slate-300">
        <Tier name="Cheap model" s={stats.cheap} />
        <Tier name="Expensive model" s={stats.expensive} />
      </dl>
    </aside>
  )
}
