import { formatDuration, limitRecovery, type LimitPoolWindow } from "@t3tools/shared/usageLimits";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { Circle, Line, Path, Svg } from "react-native-svg";

import { AppText as Text } from "../../components/AppText";

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
  const [expanded, setExpanded] = useState(false);
  const points = limitRecovery(
    pool.members.map((member) => member.window),
    now,
  );
  const last = points[points.length - 1];
  if (!last || points.length < 2) return null;
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
  const label = (at: number) => (at === now ? "Now" : `In ${formatDuration(at - now)}`);

  return (
    <View className="gap-2 border-t border-border pt-3">
      <Text className="text-xs font-t3-medium text-foreground">Scheduled recovery</Text>
      <Text className="text-xs tabular-nums text-foreground-muted">
        {label(last.at)} · {Math.round(last.remainingPercent)}% left
      </Text>
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
          accessibilityLabel={`${pool.label} scheduled quota recovery, assuming no further usage. ${points.map((point) => `${label(point.at)}, ${Math.round(point.remainingPercent)}% left`).join(". ")}`}
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
            <Path d={`${path} V${HEIGHT} H0 Z`} fill={color} fillOpacity={0.08} />
            <Path
              d={path}
              fill="none"
              stroke={color}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
            {points.map((point) => (
              <Circle
                key={point.at}
                cx={x(point.at)}
                cy={y(point.remainingPercent)}
                r={3}
                fill={color}
              />
            ))}
          </Svg>
        </View>
      </View>
      <View className="flex-row justify-between pl-10">
        <Text className="text-[10px] text-foreground-tertiary">Now</Text>
        <Text className="text-[10px] text-foreground-tertiary">{label(now + duration)}</Text>
      </View>
      <Text className="text-xs text-foreground-tertiary">
        Assumes no further usage. Accounts are weighted equally; only future reported resets are
        included.
      </Text>
      {points.length > 2 ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            onPress={() => setExpanded((value) => !value)}
            className="min-h-[44px] justify-center active:opacity-60"
          >
            <Text className="text-xs font-t3-medium text-foreground">
              {expanded ? "Hide reset schedule" : "Show reset schedule"}
            </Text>
          </Pressable>
          {expanded
            ? points.slice(1).map((point) => (
                <View key={point.at} className="flex-row justify-between gap-2">
                  <Text className="text-xs text-foreground-muted">{label(point.at)}</Text>
                  <Text className="text-xs tabular-nums text-foreground">
                    {Math.round(point.remainingPercent)}% left
                  </Text>
                </View>
              ))
            : null}
        </>
      ) : null}
    </View>
  );
}
