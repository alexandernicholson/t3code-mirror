import {
  collectLimitHistoryLines,
  type EnvironmentUsageLimitHistory,
  type LimitAccount,
  type LimitPoolWindow,
} from "@t3tools/shared/usageLimits";
import { useMemo, useState } from "react";

const WIDTH = 600;
const HEIGHT = 120;

function accountColor(account: LimitAccount, index: number, fallback: string, count: number) {
  if (count === 1) return fallback;
  const key = account.email ?? account.displayName ?? account.key;
  let hash = 0;
  for (let position = 0; position < key.length; position += 1) {
    hash = (hash * 31 + key.charCodeAt(position)) | 0;
  }
  return `hsl(${Math.abs(hash + index * 47) % 360} 70% 55%)`;
}

function accountLabel(account: LimitAccount, index: number) {
  return account.displayName ?? `Account ${index + 1}`;
}

export function UsageHistoryChart({
  pool,
  color,
  now,
  since,
  histories,
}: {
  readonly pool: LimitPoolWindow;
  readonly color: string;
  readonly now: number;
  readonly since: number;
  readonly histories: readonly EnvironmentUsageLimitHistory[];
}) {
  const [selected, setSelected] = useState<{
    readonly line: number;
    readonly point: number;
  } | null>(null);
  const lines = useMemo(
    () =>
      collectLimitHistoryLines(pool, histories, since, now).map(({ account, points }, index) => {
        return {
          account,
          label: accountLabel(account, index),
          color: accountColor(account, index, color, pool.members.length),
          points,
        };
      }),
    [color, histories, now, pool, since],
  );
  const x = (at: number) => ((at - since) / Math.max(1, now - since)) * WIDTH;
  const y = (used: number) => HEIGHT - (used / 100) * HEIGHT;
  const active = selected ? lines[selected.line]?.points[selected.point] : undefined;
  const activeLine = selected ? lines[selected.line] : undefined;

  return (
    <div className="min-w-0 border-t border-border/60 pt-3 md:col-start-2">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <h3 className="font-medium text-foreground">Usage history</h3>
        <span className="text-muted-foreground tabular-nums" aria-live="polite">
          {active && activeLine
            ? `${activeLine.label} · ${Math.round(active.usedPercent)}% used · ${new Date(active.observedAt).toLocaleString()}`
            : `${Math.round(pool.usedPercent)}% used now`}
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
          aria-label={`${pool.label} usage history`}
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
          {lines.map((line, lineIndex) => {
            const path = line.points
              .map(
                (point, pointIndex) =>
                  `${pointIndex === 0 ? "M" : "L"}${x(Date.parse(point.observedAt))},${y(point.usedPercent)}`,
              )
              .join(" ");
            return (
              <g key={line.account.key}>
                {path ? (
                  <path
                    d={path}
                    fill="none"
                    stroke={line.color}
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                {line.points.map((point, pointIndex) => (
                  <circle
                    key={point.observedAt}
                    cx={x(Date.parse(point.observedAt))}
                    cy={y(point.usedPercent)}
                    r={selected?.line === lineIndex && selected.point === pointIndex ? 4 : 2.5}
                    fill={line.color}
                    tabIndex={0}
                    role="img"
                    aria-label={`${line.label}, ${Math.round(point.usedPercent)}% used at ${new Date(point.observedAt).toLocaleString()}`}
                    className="outline-none focus-visible:stroke-ring"
                    onFocus={() => setSelected({ line: lineIndex, point: pointIndex })}
                    onBlur={() => setSelected(null)}
                    onMouseEnter={() => setSelected({ line: lineIndex, point: pointIndex })}
                  />
                ))}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-1 flex justify-between pl-10 text-[10px] text-muted-foreground">
        <span>{new Date(since).toLocaleDateString()}</span>
        <span>Now</span>
      </div>
      {lines.length > 1 ? (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {lines.map((line) => (
            <span key={line.account.key} className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ backgroundColor: line.color }} />
              {line.label}
            </span>
          ))}
        </div>
      ) : null}
      {lines.every((line) => line.points.length <= 1) ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          History starts as T3 observes new limit snapshots.
        </p>
      ) : null}
    </div>
  );
}
