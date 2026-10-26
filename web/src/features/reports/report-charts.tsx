import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useTheme } from '@/context/theme-provider'
import type { ReportChart } from '@/types/api'

/** Los colores vienen del backend (paleta Supernova, igual que en el PDF). En modo oscuro se aclaran los que no se verían. */
const DARK_SWAP: Record<string, string> = {
  '#040167': '#7777d5',
  '#96731a': '#f0d998',
  '#059669': '#34d399',
  '#dc2626': '#f87171',
  '#5a5acb': '#7777d5',
}
const FALLBACK = ['#040167', '#5a5acb', '#96731a', '#94a3b8']

const tooltipStyle = {
  background: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--popover-foreground)',
}

const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 })

export function ReportChartView({ chart }: { chart: ReportChart }) {
  const dark = useTheme().resolvedTheme === 'dark'
  const color = (c: string | undefined, i: number) => {
    const base = c ?? FALLBACK[i % FALLBACK.length]!
    return dark ? (DARK_SWAP[base.toLowerCase()] ?? base) : base
  }
  const data: Record<string, string | number>[] = chart.categories.map((name, i) => ({
    name,
    ...Object.fromEntries(chart.series.map((s, si) => [`s${si}`, s.values[i] ?? 0])),
  }))
  const axis = { fontSize: 11, stroke: 'var(--muted-foreground)', tickLine: false, axisLine: false } as const
  const grid = <CartesianGrid vertical={false} stroke="var(--border)" />
  const multi = chart.series.length > 1

  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 text-sm font-semibold">{chart.title}</figcaption>
      <div className="h-64 w-full" role="img" aria-label={chart.title}>
        <ResponsiveContainer width="100%" height="100%">
          {chart.kind === 'line' ? (
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
              {grid}
              <XAxis dataKey="name" {...axis} interval="preserveStartEnd" minTickGap={14} />
              <YAxis {...axis} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {chart.series.map((s, i) => (
                <Line key={s.name} type="monotone" dataKey={`s${i}`} name={s.name} stroke={color(s.color, i)} strokeWidth={2} dot={chart.categories.length <= 31} />
              ))}
            </LineChart>
          ) : chart.kind === 'donut' ? (
            <PieChart>
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => nf.format(Number(v))} />
              <Pie
                data={data}
                dataKey="s0"
                nameKey="name"
                innerRadius="58%"
                outerRadius="85%"
                paddingAngle={data.filter((d) => Number(d.s0) > 0).length > 1 ? 2 : 0}
                stroke="var(--card)"
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={color(chart.colors?.[i], i)} />
                ))}
              </Pie>
              <Legend verticalAlign="middle" align="right" layout="vertical" iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          ) : chart.kind === 'hbar' ? (
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 0 }}>
              <CartesianGrid horizontal={false} stroke="var(--border)" />
              <XAxis type="number" {...axis} allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={130} {...axis} tickFormatter={(v: string) => (v.length > 20 ? `${v.slice(0, 19)}…` : v)} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--muted)', opacity: 0.5 }} />
              <Bar dataKey="s0" name={chart.series[0]?.name} fill={color(chart.series[0]?.color, 0)} radius={[0, 4, 4, 0]} maxBarSize={22} label={{ position: 'right', fontSize: 11, fill: 'var(--foreground)' }} />
            </BarChart>
          ) : (
            <BarChart data={data} margin={{ top: 14, right: 8, bottom: 0, left: -18 }}>
              {grid}
              <XAxis dataKey="name" {...axis} interval="preserveStartEnd" minTickGap={10} />
              <YAxis {...axis} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--muted)', opacity: 0.5 }} />
              {multi && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {chart.series.map((s, i) => (
                <Bar key={s.name} dataKey={`s${i}`} name={s.name} fill={color(s.color, i)} radius={[4, 4, 0, 0]} maxBarSize={36} label={chart.categories.length <= 12 ? { position: 'top', fontSize: 11, fill: 'var(--foreground)' } : undefined} />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      {chart.note && <p className="mt-1 text-xs text-muted-foreground">{chart.note}</p>}
    </figure>
  )
}
