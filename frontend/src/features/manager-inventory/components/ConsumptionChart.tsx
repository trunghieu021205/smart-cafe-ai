import type { DailyConsumption } from '../model';
import { formatQty } from '../model';

const W = 320;
const H = 140;
const PAD_X = 8;
const TOP = 18;
const BOTTOM = 22;

/** Biểu đồ cột tiêu thụ theo ngày, vẽ bằng SVG thuần (không dùng thư viện chart). */
export function ConsumptionChart({ data, unit }: { data: DailyConsumption[]; unit: string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const plotH = H - TOP - BOTTOM;
  const slot = (W - PAD_X * 2) / data.length;
  const barW = slot * 0.56;
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const summary = `Tiêu thụ 7 ngày gần nhất: tổng ${formatQty(total)} ${unit}. ${data.map((d) => `${d.label}: ${formatQty(d.value)}`).join('; ')}.`;

  return (
    <figure className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className="h-auto w-full">
        <line x1={PAD_X} x2={W - PAD_X} y1={TOP + plotH} y2={TOP + plotH} className="stroke-gray-200" strokeWidth={1} />
        {data.map((d, i) => {
          const h = d.value > 0 ? Math.max(3, (d.value / max) * plotH) : 0;
          const x = PAD_X + i * slot + (slot - barW) / 2;
          const y = TOP + plotH - h;
          const isToday = i === data.length - 1;
          return (
            <g key={d.date}>
              <title>{`${d.label}: ${formatQty(d.value)} ${unit}`}</title>
              {d.value > 0 ? (
                <>
                  <rect x={x} y={y} width={barW} height={h} rx={3} className={isToday ? 'fill-primary-700' : 'fill-primary-400'} />
                  <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize={9} className="fill-gray-600">
                    {formatQty(d.value)}
                  </text>
                </>
              ) : (
                <rect x={x} y={TOP + plotH - 2} width={barW} height={2} rx={1} className="fill-gray-200" />
              )}
              <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize={9} className="fill-gray-500">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="text-caption text-gray-500">
        {total > 0 ? `Trung bình ${formatQty(Math.round(total / data.length))} ${unit}/ngày · đơn vị: ${unit}` : 'Chưa có tiêu thụ trong 7 ngày qua.'}
      </figcaption>
    </figure>
  );
}
