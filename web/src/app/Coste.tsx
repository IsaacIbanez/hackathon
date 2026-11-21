import type { StatsPayload, TierStats } from '../api'

// Contador de coste y latencia (frugalidad, criterio de AXA). Sin aria-live a propósito:
// cambia tras cada llamada y leerlo en voz alta cada vez molestaría.

const usd = (n: number) => `${n.toFixed(4)} $`

function Nivel({ nombre, s }: { nombre: string; s: TierStats }) {
  return (
    <div>
      <dt className="font-semibold">{nombre}</dt>
      <dd>
        {s.calls} llamadas · {s.cacheHits} en caché · {usd(s.costUsd)}
        {s.calls > 0 && <> · {s.avgLatencyMs} ms de media</>}
        {s.errors > 0 && <> · {s.errors} errores</>}
      </dd>
    </div>
  )
}

export function Coste({ stats }: { stats: StatsPayload | null }) {
  if (!stats) return null
  return (
    <aside aria-label="Coste de la IA" className="mt-8 rounded-xl border border-slate-700 p-4 text-lg">
      <p className="text-2xl">
        Coste de la IA: <strong>{usd(stats.totalCostUsd)}</strong>
      </p>
      <dl className="mt-2 space-y-1 text-slate-300">
        <Nivel nombre="Modelo barato" s={stats.barato} />
        <Nivel nombre="Modelo caro" s={stats.caro} />
      </dl>
    </aside>
  )
}
