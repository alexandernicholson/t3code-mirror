import { formatDuration, limitRecovery, type LimitPoolWindow } from "@t3tools/shared/usageLimits";
import { useState } from "react";

const WIDTH = 600;
const HEIGHT = 120;

export function UsageRecoveryChart({
  pool,
  color,
  now,
}: {
  readonly pool: LimitPoolWindow;
  readonly color: string;
  readonly now: number;
}) {
  const points = limitRecovery(
    pool.members.map((member) => member.window),
    now,
  );
  const [selected, setSelected] = useState<number | null>(null);
  const last = points.at(-1);
  if (!last || points.length < 2) return null;
  // Leave room after the final reset so its plateau is visible.
  const duration = (last.at - now) * 1.08;
  const x = (at: number) => ((at - now) / duration) * WIDTH;
  const y = (remaining: number) => HEIGHT - (remaining / 100) * HEIGHT;
  const path =
    points
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "H"}${x(point.at)}${index === 0 ? "," : "V"}${y(point.remainingPercent)}`,
      )
      .join(" ") + ` H${WIDTH}`;
  const active = points[selected ?? points.length - 1] ?? last;
  const label = (at: number) => (at === now ? "Now" : `In ${formatDuration(at - now)}`);

  return (
    <div className="min-w-0 border-t border-border/60 pt-3 md:col-start-2">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <h3 className="font-medium text-foreground">Scheduled recovery</h3>
        <span className="text-muted-foreground tabular-nums" aria-live="polite">
          {label(active.at)} · {Math.round(active.remainingPercent)}% left
        </span>
      </div>
      <div className="flex gap-2">
        <div className="flex h-32 w-8 shrink-0 flex-col justify-between text-right text-[10px] text-muted-foreground tabular-nums">
          <span>100%</span>
          <span>50%</span>
          <span>0%</span>
        </div>
        <svg
          viewBox={`0 -4 ${WIDTH} ${HEIGHT + 8}`}
          preserveAspectRatio="none"
          className="h-32 min-w-0 flex-1 overflow-visible"
          role="group"
          aria-label={`${pool.label} scheduled quota recovery, assuming no further usage`}
          onMouseLeave={() => setSelected(null)}
        >
          {[0, 50, 100].map((value) => (
            <line
              key={value}
              x1={0}
              x2={WIDTH}
              y1={y(value)}
              y2={y(value)}
              stroke="currentColor"
              className="text-border"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path d={`${path} V${HEIGHT} H0 Z`} fill={color} fillOpacity={0.08} />
          <path
            d={path}
            fill="none"
            stroke={color}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          {points.map((point, index) => (
            <g key={point.at}>
              <circle cx={x(point.at)} cy={y(point.remainingPercent)} r={3} fill={color} />
              <circle
                cx={x(point.at)}
                cy={y(point.remainingPercent)}
                r={10}
                fill="transparent"
                tabIndex={0}
                role="img"
                aria-label={`${label(point.at)}, ${Math.round(point.remainingPercent)}% left`}
                className="outline-none focus-visible:stroke-ring"
                onFocus={() => setSelected(index)}
                onBlur={() => setSelected(null)}
                onMouseEnter={() => setSelected(index)}
                onClick={() => setSelected(index)}
              />
            </g>
          ))}
        </svg>
      </div>
      <div className="mt-1 flex justify-between pl-10 text-[10px] text-muted-foreground">
        <span>Now</span>
        <span>{label(now + duration)}</span>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Assumes no further usage. Accounts are weighted equally; only future reported resets are
        included.
      </p>
    </div>
  );
}
