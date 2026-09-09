import {
  collectLimitHistoryLines,
  type EnvironmentUsageLimitHistory,
  type LimitAccount,
  type LimitPoolWindow,
} from "@t3tools/shared/usageLimits";
import { useMemo } from "react";
import { View } from "react-native";
import { Circle, Line, Path, Svg } from "react-native-svg";

import { AppText as Text } from "../../components/AppText";

const WIDTH = 600;
const HEIGHT = 120;

function lineColor(account: LimitAccount, index: number, fallback: string, count: number) {
  if (count === 1) return fallback;
  const key = account.email ?? account.displayName ?? account.key;
  let hash = 0;
  for (let position = 0; position < key.length; position += 1) {
    hash = (hash * 31 + key.charCodeAt(position)) | 0;
  }
  return `hsl(${Math.abs(hash + index * 47) % 360}, 70%, 55%)`;
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
  const lines = useMemo(
    () =>
      collectLimitHistoryLines(pool, histories, since, now).map(({ account, points }, index) => {
        return {
          account,
          label: account.displayName ?? `Account ${index + 1}`,
          color: lineColor(account, index, color, pool.members.length),
          points,
        };
      }),
    [color, histories, now, pool, since],
  );
  const x = (at: number) => ((at - since) / Math.max(1, now - since)) * WIDTH;
  const y = (used: number) => HEIGHT - (used / 100) * HEIGHT;

  return (
    <View className="gap-2 border-t border-border pt-3">
      <View className="flex-row items-baseline justify-between gap-2">
        <Text className="text-xs font-t3-medium text-foreground">Usage history</Text>
        <Text className="text-xs tabular-nums text-foreground-muted">
          {Math.round(pool.usedPercent)}% used now
        </Text>
      </View>
      <View className="flex-row gap-2">
        <View className="h-32 w-8 justify-between">
          {[100, 50, 0].map((value) => (
            <Text
              key={value}
              className="text-right text-[10px] tabular-nums text-foreground-tertiary"
            >
              {value}%
            </Text>
          ))}
        </View>
        <View
          className="h-32 min-w-0 flex-1"
          accessible
          accessibilityRole="image"
          accessibilityLabel={`${pool.label} usage history. ${lines
            .map((line) => `${line.label}, ${line.points.at(-1)?.usedPercent ?? 0}% used`)
            .join(". ")}`}
        >
          <Svg
            width="100%"
            height="100%"
            viewBox={`0 -4 ${WIDTH} ${HEIGHT + 8}`}
            preserveAspectRatio="none"
            accessible={false}
          >
            {[0, 50, 100].map((value) => (
              <Line
                key={value}
                x1={0}
                x2={WIDTH}
                y1={y(value)}
                y2={y(value)}
                stroke={color}
                opacity={0.15}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {lines.map((line) => {
              const path = line.points
                .map(
                  (point, index) =>
                    `${index === 0 ? "M" : "L"}${x(Date.parse(point.observedAt))},${y(point.usedPercent)}`,
                )
                .join(" ");
              return (
                <Path
                  key={line.account.key}
                  d={path}
                  fill="none"
                  stroke={line.color}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {lines.flatMap((line) =>
              line.points.map((point) => (
                <Circle
                  key={`${line.account.key}:${point.observedAt}`}
                  cx={x(Date.parse(point.observedAt))}
                  cy={y(point.usedPercent)}
                  r={2.5}
                  fill={line.color}
                />
              )),
            )}
          </Svg>
        </View>
      </View>
      <View className="flex-row justify-between pl-10">
        <Text className="text-[10px] text-foreground-tertiary">
          {new Date(since).toLocaleDateString()}
        </Text>
        <Text className="text-[10px] text-foreground-tertiary">Now</Text>
      </View>
      {lines.length > 1 ? (
        <View className="flex-row flex-wrap gap-x-3 gap-y-1">
          {lines.map((line) => (
            <View key={line.account.key} className="flex-row items-center gap-1.5">
              <View className="size-2 rounded-full" style={{ backgroundColor: line.color }} />
              <Text className="text-xs text-foreground-muted">{line.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {lines.every((line) => line.points.length <= 1) ? (
        <Text className="text-xs text-foreground-tertiary">
          History starts as T3 observes new limit snapshots.
        </Text>
      ) : null}
    </View>
  );
}
