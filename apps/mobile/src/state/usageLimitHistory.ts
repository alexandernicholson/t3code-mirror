import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, UsageLimitHistory, UsageLimitHistoryInput } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { environmentPresentations } from "./presentation";
import { serverEnvironment } from "./server";

export interface EnvironmentUsageLimitHistory {
  readonly environmentId: EnvironmentId;
  readonly history: UsageLimitHistory | null;
}

const historyByWindowAtom = Atom.family((windowKey: string) =>
  Atom.make((get): readonly EnvironmentUsageLimitHistory[] => {
    const input = JSON.parse(windowKey) as UsageLimitHistoryInput;
    const presentations = get(environmentPresentations.presentationsAtom);
    return [...presentations].map(([environmentId]) => ({
      environmentId,
      history: Option.getOrNull(
        AsyncResult.value(get(serverEnvironment.usageLimitHistory({ environmentId, input }))),
      ),
    }));
  }).pipe(Atom.withLabel(`mobile-usage-limit-history:${windowKey}`)),
);

export function useUsageLimitHistory(
  input: UsageLimitHistoryInput,
  selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null,
) {
  const windowKey = useMemo(() => JSON.stringify(input), [input]);
  const atom = historyByWindowAtom(windowKey);
  const histories = useAtomValue(atom);
  return useMemo(
    () =>
      selectedEnvironmentIds === null
        ? histories
        : histories.filter(({ environmentId }) => selectedEnvironmentIds.has(environmentId)),
    [histories, selectedEnvironmentIds],
  );
}
