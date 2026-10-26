import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatMediumDate } from '@/lib/format'
import type { DashboardSummary } from '@/types/api'

type Props = { series: DashboardSummary['series']; today: string }

export function ActivityChart({ series, today }: Props) {
  const data = series.map((p) => ({
    ...p,
    label: String(Number(p.date.slice(8))),
  }))

  return (
    <div className='h-64 w-full' role='img' aria-label='Gráfico de citas por día'>
      <ResponsiveContainer width='100%' height='100%'>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <CartesianGrid vertical={false} stroke='var(--border)' />
          <XAxis dataKey='label' tickLine={false} axisLine={false} fontSize={11} stroke='var(--muted-foreground)' interval={0} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} stroke='var(--muted-foreground)' />
          <Tooltip
            cursor={{ fill: 'var(--muted)', opacity: 0.5 }}
            contentStyle={{
              background: 'var(--popover)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 12,
              color: 'var(--popover-foreground)',
            }}
            labelFormatter={(_, payload) => {
              const date = payload?.[0]?.payload?.date as string | undefined
              return date ? formatMediumDate(date) : ''
            }}
            formatter={(value, name) => [value, name === 'active' ? 'Citas' : 'Canceladas']}
          />
          <Bar dataKey='active' stackId='a' radius={[0, 0, 0, 0]} maxBarSize={28}>
            {data.map((p) => (
              <Cell key={p.date} fill='var(--chart-1)' fillOpacity={p.date === today ? 1 : 0.65} />
            ))}
          </Bar>
          <Bar dataKey='cancelled' stackId='a' fill='var(--chart-4)' fillOpacity={0.55} radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
