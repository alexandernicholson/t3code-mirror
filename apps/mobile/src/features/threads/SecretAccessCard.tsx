import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { useState } from "react";
import { Pressable, View } from "react-native";
import type { EnvironmentId, SecretApprovalInput, ThreadId } from "@t3tools/contracts";
import { AppText as Text } from "../../components/AppText";
import { InfoButton } from "../../components/InfoButton";
import { secrets } from "../../state/secrets";
import { useAtomCommand } from "../../state/use-atom-command";

export function SecretAccessCard({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const snapshot = useAtomValue(secrets.snapshot({ environmentId, input: {} }));
  const respond = useAtomCommand(secrets.respond);
  const revoke = useAtomCommand(secrets.revoke);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  if (!AsyncResult.isSuccess(snapshot)) return null;
  const request = snapshot.value.pendingReads.find((entry) => entry.threadId === threadId);
  const grants = snapshot.value.threadGrants.filter((entry) => entry.threadId === threadId);
  if (!request)
    return grants.length === 0 ? null : (
      <View className="mx-4 mb-3 gap-2 rounded-xl border border-border bg-card p-3">
        <Text className="text-sm text-foreground-muted">
          Thread access: {grants.map((entry) => entry.key).join(", ")}
        </Text>
        <Pressable
          accessibilityRole="button"
          className="min-h-11 justify-center"
          disabled={busy}
          onPress={() => {
            setBusy(true);
            void revoke({ environmentId, input: { threadId } }).then((result) => {
              setBusy(false);
              setError(result._tag !== "Success");
            });
          }}
        >
          <Text className="text-foreground">Revoke thread access</Text>
        </Pressable>
        {error && (
          <Text accessibilityRole="alert" className="text-foreground-muted">
            Could not revoke access. Try again.
          </Text>
        )}
      </View>
    );
  async function decide(decision: SecretApprovalInput["decision"]) {
    if (!request || busy) return;
    setBusy(true);
    setError(false);
    const result = await respond({
      environmentId,
      input: { requestId: request.requestId, decision },
    });
    setBusy(false);
    setError(result._tag !== "Success");
  }
  return (
    <View className="mx-4 mb-3 gap-2 rounded-xl border border-border bg-card p-4">
      <View className="flex-row items-start justify-between gap-3">
        <Text className="flex-1 font-t3-medium text-foreground">
          Allow access to {request.key}?
        </Text>
        <InfoButton
          label="Secret access details"
          details="Thread access applies to this secret until you revoke it, the secret changes, or the environment restarts."
        />
      </View>
      <Text className="text-sm text-foreground-muted">
        {request.scope.type === "environment" ? "Environment-wide" : "Project secret"}
      </Text>
      <Text className="text-sm text-foreground">{request.reason}</Text>
      <View className="flex-row flex-wrap gap-2">
        {(
          [
            ["once", "Allow once"],
            ["thread", "Allow for thread"],
            ["deny", "Deny"],
          ] as const
        ).map(([decision, label]) => (
          <Pressable
            key={decision}
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void decide(decision)}
            className="min-h-11 justify-center rounded-lg border border-border px-3"
          >
            <Text className="text-foreground">{label}</Text>
          </Pressable>
        ))}
      </View>
      {error && (
        <Text accessibilityRole="alert" className="text-sm text-foreground-muted">
          Could not respond. Try again.
        </Text>
      )}
    </View>
  );
}
