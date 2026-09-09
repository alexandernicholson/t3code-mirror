import { useRef, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, View } from "react-native";
import type { EnvironmentId, MessageId, QueuedTurn, ThreadId } from "@t3tools/contracts";
import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@t3tools/contracts";
import { assetUrlStateFromResult } from "@t3tools/client-runtime/state/assets";
import { AppText as Text } from "../../components/AppText";
import { useSelectedThreadDetail } from "../../state/use-thread-detail";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { threadEnvironment } from "../../state/threads";
import { assetEnvironment } from "../../state/assets";
import { usePreparedConnection } from "../../state/session";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { downloadAttachmentForPreview } from "../../lib/attachmentDownload";
import {
  persistComposerAttachmentFile,
  type DraftComposerAttachment,
} from "../../lib/composerImages";
import {
  flushComposerDrafts,
  getComposerDraftSnapshot,
  mergeComposerDraftContent,
  scheduleUnusedComposerAttachmentCleanup,
  undoComposerDraftMerge,
  updateComposerDraftSettings,
  useComposerDraft,
} from "../../state/use-composer-drafts";

/** Kept outside the collapsing editor so delivery is always visible. */
export function TurnQueueControls(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  supported: boolean;
  connected: boolean;
  onRestored: () => void;
}) {
  const draftKey = scopedThreadKey(props.environmentId, props.threadId);
  const draft = useComposerDraft(draftKey);
  const detail = useSelectedThreadDetail();
  const queue = detail?.id === props.threadId ? detail.turnQueue : undefined;
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const updateQueue = useAtomCommand(threadEnvironment.updateQueue, { reportFailure: false });
  const createUrl = useAtomQueryRunner(assetEnvironment.createUrl, { refresh: true });
  const connection = usePreparedConnection(props.environmentId);
  const action = async (action: "cancel" | "steer" | "resume", messageId?: MessageId) => {
    const result = await updateQueue({
      environmentId: props.environmentId,
      input: {
        threadId: props.threadId,
        action,
        ...(messageId ? { messageId } : {}),
      },
    });
    if (result._tag !== "Success")
      throw new Error(
        "The message may already have been sent or removed. Reconnect and try again.",
      );
  };
  const run = async (work: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await work();
    } catch (error) {
      Alert.alert("Queue", String(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const restore = async (item: QueuedTurn) => {
    if (connection._tag !== "Some") throw new Error("Connect to restore this message.");
    const attachments: DraftComposerAttachment[] = [];
    let rollback: {
      before: ReturnType<typeof getComposerDraftSnapshot>;
      after: ReturnType<typeof getComposerDraftSnapshot>;
    } | null = null;
    try {
      for (const attachment of item.attachments) {
        const url = assetUrlStateFromResult(
          await createUrl({
            environmentId: props.environmentId,
            input: {
              resource: {
                _tag: "attachment",
                attachmentId: attachment.id,
                fileName: attachment.name,
                mimeType: attachment.mimeType,
              },
            },
          }),
          connection.value.httpBaseUrl,
        );
        if (url._tag !== "Success") throw new Error(`Could not restore ${attachment.name}`);
        const downloaded = await downloadAttachmentForPreview({
          url: url.url,
          attachment,
          signal: new AbortController().signal,
        });
        if (!downloaded) throw new Error(`Could not restore ${attachment.name}`);
        let fileUri: string;
        try {
          fileUri = await persistComposerAttachmentFile(downloaded.uri, attachment.name);
        } finally {
          downloaded.dispose();
        }
        const common = {
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          fileUri,
          uploadedAttachmentId: attachment.id,
          uploadEnvironmentId: props.environmentId,
        };
        attachments.push(
          attachment.type === "image"
            ? { ...common, type: "image", previewUri: fileUri }
            : { ...common, type: "file" },
        );
      }
      const before = getComposerDraftSnapshot(draftKey);
      if (before.attachments.length + attachments.length > PROVIDER_SEND_TURN_MAX_ATTACHMENTS)
        throw new Error("Remove attachments from your draft before restoring this message.");
      try {
        await mergeComposerDraftContent(draftKey, { text: item.text, attachments });
      } finally {
        rollback = { before, after: getComposerDraftSnapshot(draftKey) };
      }
      updateComposerDraftSettings(draftKey, {
        delivery: "queue",
        modelSelection: item.modelSelection,
        runtimeMode: item.runtimeMode,
        interactionMode: item.interactionMode,
      });
      rollback = { before, after: getComposerDraftSnapshot(draftKey) };
      await flushComposerDrafts();
      await action("cancel", item.messageId);
      rollback = null;
      setExpanded(false);
      props.onRestored();
    } finally {
      if (rollback) await undoComposerDraftMerge(draftKey, rollback.before, rollback.after);
      scheduleUnusedComposerAttachmentCleanup(attachments);
    }
  };
  const count = queue?.items.length ?? 0;
  return (
    <View className="gap-2 px-3 py-2">
      <View className="flex-row items-center justify-between gap-2">
        <View
          className="flex-row rounded-xl border border-border bg-surface p-1"
          accessibilityRole="radiogroup"
          accessibilityLabel="Message delivery"
        >
          {(["steer", "queue"] as const).map((delivery) => (
            <Pressable
              key={delivery}
              accessibilityRole="radio"
              accessibilityState={{
                checked: (draft.delivery ?? "steer") === delivery,
                disabled: delivery === "queue" && !props.supported,
              }}
              disabled={delivery === "queue" && !props.supported}
              onPress={() => updateComposerDraftSettings(draftKey, { delivery })}
              className={`rounded-lg px-4 py-2 ${(draft.delivery ?? "steer") === delivery ? "bg-muted" : ""}`}
            >
              <Text
                className={`text-xs font-semibold ${delivery === "queue" && !props.supported ? "text-muted-foreground" : "text-foreground"}`}
              >
                {delivery === "steer" ? "Steer" : "Queue"}
              </Text>
            </Pressable>
          ))}
        </View>
        {count > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setExpanded(!expanded)}
            className="px-2 py-2"
          >
            <Text className="text-xs text-foreground">
              {queue?.paused ? "Paused" : "Next up"} · {count}
            </Text>
          </Pressable>
        ) : (
          <Text className="shrink text-xs text-muted-foreground">
            {draft.delivery === "queue" ? "After this turn" : "Send into current work"}
          </Text>
        )}
      </View>
      <Modal
        visible={expanded}
        transparent
        animationType="slide"
        onRequestClose={() => setExpanded(false)}
      >
        <View className="flex-1 justify-end bg-black/40">
          <Pressable
            className="flex-1"
            accessibilityRole="button"
            accessibilityLabel="Close queue"
            onPress={() => setExpanded(false)}
          />
          <View className="rounded-t-3xl bg-screen px-5 pb-10 pt-4" style={{ maxHeight: "70%" }}>
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-base font-semibold text-foreground">
                {queue?.paused ? "Queue paused" : "Next up"} · {count}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setExpanded(false)}
                className="p-2"
              >
                <Text className="text-sm text-foreground">Done</Text>
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }}>
              {queue?.paused && (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy || !props.connected}
                  onPress={() => void run(() => action("resume"))}
                >
                  <Text className="text-sm text-foreground">Resume queue</Text>
                </Pressable>
              )}
              {queue?.items.map((item, index) => (
                <View key={item.messageId} className="gap-1">
                  <Text className="text-xs text-foreground" numberOfLines={2}>
                    {index + 1}. {item.text || "Attachment"}
                  </Text>
                  <View className="flex-row gap-4">
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy || !props.connected}
                      onPress={() => void run(() => restore(item))}
                      className="py-2"
                    >
                      <Text className="text-xs text-muted-foreground">Edit</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy || !props.connected}
                      onPress={() => void run(() => action("steer", item.messageId))}
                      className="py-2"
                    >
                      <Text className="text-xs text-muted-foreground">Send now</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy || !props.connected}
                      onPress={() => void run(() => action("cancel", item.messageId))}
                      className="py-2"
                    >
                      <Text className="text-xs text-muted-foreground">Remove</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
              {count === 0 && (
                <Text className="py-4 text-sm text-muted-foreground">No queued messages.</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
