import {
  AdvisorError,
  CommandId,
  MessageId,
  ThreadId,
  emptyAdvisorConfiguration,
  type AdvisorAction,
  type AdvisorConfiguration,
  type AdvisorDefinition,
  type AdvisorEntry,
  type AdvisorState,
} from "@t3tools/contracts";
import {
  Context,
  Crypto,
  DateTime,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Path,
  Schema,
  Semaphore,
  Stream,
} from "effect";
import { AdvisorStore } from "./AdvisorStore.ts";
import { AdvisorRunner } from "./AdvisorRunner.ts";
import { advisorMayGuide, advisorSourceText, resolveAdvisors } from "./AdvisorPolicy.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";

const isAdvisorError = Schema.is(AdvisorError);
const decodeDelivery = Schema.decodeUnknownEffect(Schema.Struct({ findingId: Schema.String }));
const decodeDeliveryFailure = Schema.decodeUnknownEffect(
  Schema.Struct({ requestId: Schema.String, detail: Schema.String }),
);

export const make = Effect.gen(function* () {
  const store = yield* AdvisorStore;
  const runner = yield* AdvisorRunner;
  const engine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const crypto = yield* Crypto.Crypto;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const scope = yield* Effect.scope;
  const workers = new Map<ThreadId, Fiber.Fiber<void>>();
  const guidanceMutex = yield* Semaphore.make(1);
  const dirty = new Set<ThreadId>();
  const initialCursors = new Map<ThreadId, number>();
  const guidedTurns = new Map<ThreadId, { turnId: string; severity: string }>();
  let started = false;
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const fail = (message: string) => new AdvisorError({ message });
  const entry = Effect.fn("Advisors.entry")(function* (
    threadId: ThreadId,
    definition: AdvisorDefinition,
    sourceSequence: number,
    kind: AdvisorEntry["kind"],
    text: string,
    extra: Partial<Pick<AdvisorEntry, "severity" | "findingId">> = {},
  ) {
    const value: AdvisorEntry = {
      id: yield* crypto.randomUUIDv4,
      threadId,
      advisorId: definition.id,
      advisorName: definition.name,
      kind,
      text,
      sourceSequence,
      createdAt: yield* now,
      ...extra,
    };
    yield* store.append(value);
    return value;
  });
  const deliver = Effect.fn("Advisors.deliver")(function* (
    finding: AdvisorEntry,
    automatic: boolean,
  ) {
    const current = yield* snapshots.getThreadShellById(finding.threadId);
    if (Option.isNone(current)) return yield* fail("This thread is no longer available.");
    const thread = current.value;
    if (automatic && !advisorMayGuide(thread)) return false;
    const previousGuide = guidedTurns.get(thread.id);
    if (
      automatic &&
      previousGuide?.turnId === thread.session?.activeTurnId &&
      (finding.severity !== "blocker" || previousGuide?.severity === "blocker")
    )
      return false;
    const id = `advisor:${finding.id}:${yield* crypto.randomUUIDv4}`;
    yield* engine.dispatch({
      type: "thread.turn.start",
      commandId: CommandId.make(id),
      threadId: thread.id,
      ...(automatic && thread.session?.activeTurnId
        ? { expectedActiveTurnId: thread.session.activeTurnId }
        : {}),
      delivery: "steer",
      message: {
        messageId: MessageId.make(id),
        role: "user",
        text: `[Advisor: ${finding.advisorName} · ${finding.severity ?? "concern"}]\n${finding.text}\nConsider this finding against the task and current code. Explain your response; do not assume the finding is correct.`,
        attachments: [],
      },
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      createdAt: yield* now,
    });
    if (automatic && thread.session?.activeTurnId)
      guidedTurns.set(thread.id, {
        turnId: thread.session.activeTurnId,
        severity: finding.severity ?? "concern",
      });
    yield* store.append({
      ...finding,
      id: `${finding.id}:delivery`,
      kind: "delivery",
      text: "Waiting for provider delivery",
      findingId: finding.id,
      createdAt: yield* now,
    });
    return true;
  }, guidanceMutex.withPermits(1));
  const reviewThread = Effect.fn("Advisors.reviewThread")(function* (threadId: ThreadId) {
    const threadOption = yield* snapshots.getThreadShellById(threadId);
    if (Option.isNone(threadOption)) return;
    const thread = threadOption.value;
    const resolved = resolveAdvisors(yield* store.configurations(), thread);
    const previousStates = yield* store.states(threadId);
    const head = yield* engine.latestSequence;
    for (const previous of previousStates) {
      if (!resolved.definitions.some((definition) => definition.id === previous.advisorId))
        yield* store.removeState(threadId, previous.advisorId);
      else if (resolved.paused)
        yield* store.saveState({ ...previous, status: "paused", updatedAt: yield* now });
    }
    if (resolved.paused || thread.archivedAt !== null) return;
    const project = yield* snapshots.getProjectShellById(thread.projectId);
    if (Option.isNone(project)) return;
    const cwd = thread.worktreePath ?? project.value.workspaceRoot;
    let guidance = resolved.layers
      .map((layer) => layer.instructions)
      .filter(Boolean)
      .join("\n\n");
    guidance += `\n\n${yield* fs.readFileString(path.join(cwd, "AGENTS.md")).pipe(
      Effect.map((text) => text.slice(0, 16_000)),
      Effect.orElseSucceed(() => ""),
    )}`;
    let guidanceError: string | null = null;
    for (const layer of resolved.layers) {
      if (!layer.instructionsFile.trim()) continue;
      const file = path.resolve(cwd, layer.instructionsFile);
      const relative = path.relative(cwd, file);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        guidanceError = "Advisor guidance files must be inside the workspace.";
        continue;
      }
      const contents = yield* fs.readFileString(file).pipe(Effect.option);
      if (Option.isNone(contents))
        guidanceError = `Could not read guidance file: ${layer.instructionsFile}`;
      else guidance += `\n\n${contents.value.slice(0, 16_000)}`;
    }
    yield* Effect.forEach(
      resolved.definitions,
      (definition) =>
        Effect.gen(function* () {
          let state: AdvisorState = previousStates.find(
            (value) => value.advisorId === definition.id,
          ) ?? {
            threadId,
            advisorId: definition.id,
            name: definition.name,
            status: "watching",
            reason: null,
            reviewedSequence: initialCursors.get(threadId) ?? head,
            updatedAt: yield* now,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            reviewCount: 0,
          };
          if (!previousStates.some((value) => value.advisorId === definition.id))
            yield* store.saveState(state);
          if (guidanceError) {
            yield* store.saveState({
              ...state,
              status: "unavailable",
              reason: guidanceError,
              updatedAt: yield* now,
            });
            return;
          }
          if (state.status === "unavailable" || state.reviewedSequence >= head) return;
          const events = yield* Stream.runCollect(
            engine.readThreadEvents({
              threadId,
              fromSequenceExclusive: state.reviewedSequence,
              toSequenceInclusive: head,
              limit: 200,
            }),
          );
          const sources: string[] = [];
          let sourceSize = 0;
          let cursor = state.reviewedSequence;
          for (const event of events) {
            const text = advisorSourceText(event)?.slice(0, 12_000);
            if (text && sourceSize + text.length > 40_000) break;
            cursor = event.sequence;
            if (text) {
              sources.push(`[activity ${event.sequence}] ${text}`);
              sourceSize += text.length;
            }
          }
          if (events.length === 0) cursor = head;
          if (sources.length === 0) {
            if (cursor < head) dirty.add(threadId);
            yield* store.saveState({
              ...state,
              reviewedSequence: cursor,
              status: "watching",
              updatedAt: yield* now,
            });
            return;
          }
          state = {
            ...state,
            name: definition.name,
            status: "reviewing",
            reason: null,
            updatedAt: yield* now,
          };
          yield* store.saveState(state);
          const previousEntries = yield* store.entries(threadId);
          const priorFindings = previousEntries.filter(
            (value) => value.advisorId === definition.id && value.kind === "finding",
          );
          const detail = yield* snapshots.getThreadDetailSnapshot(threadId, { turnLimit: 3 });
          const previousReviews = previousEntries
            .filter((value) => value.advisorId === definition.id && value.kind === "activity")
            .slice(-6)
            .map((value) => value.text)
            .join("\n")
            .slice(-8_000);
          const task = Option.isSome(detail)
            ? detail.value.thread.messages
                .filter((message) => message.role === "user" && !message.id.startsWith("advisor:"))
                .slice(-3)
                .map((message) => message.text)
                .join("\n")
                .slice(-12_000)
            : thread.title;
          const review = yield* runner
            .review({
              definition,
              cwd,
              context: `Earlier review context:\n${previousReviews}\n\nUser's task:\n${task}\n\nProject review guidance:\n${guidance.slice(0, 16_000)}\n\nAlready reported (do not repeat):\n${priorFindings
                .map((finding) => finding.text)
                .join("\n")
                .slice(-12_000)}\n\nNew activity:\n${sources.join("\n\n")}`,
              onActivity: (kind, text) =>
                entry(threadId, definition, cursor, kind, text).pipe(
                  Effect.asVoid,
                  Effect.catch(() => Effect.void),
                ),
            })
            .pipe(Effect.result);
          if (review._tag === "Failure") {
            yield* store.saveState({
              ...state,
              status: "unavailable",
              reason: review.failure.message,
              updatedAt: yield* now,
            });
            yield* entry(threadId, definition, cursor, "error", review.failure.message);
            return;
          }
          const fresh = yield* snapshots.getThreadShellById(threadId);
          if (Option.isNone(fresh)) return;
          const currentConfig = resolveAdvisors(yield* store.configurations(), fresh.value);
          if (
            currentConfig.paused ||
            !currentConfig.definitions.some((value) => value.id === definition.id)
          )
            return;
          const result = review.success;
          yield* entry(threadId, definition, cursor, "activity", result.summary);
          let guided = false;
          for (const finding of result.findings) {
            if (
              priorFindings.some(
                (previous) =>
                  previous.text.trim().toLowerCase() === finding.text.trim().toLowerCase(),
              )
            )
              continue;
            const recorded = yield* entry(threadId, definition, cursor, "finding", finding.text, {
              severity: finding.severity,
            });
            if (!guided && definition.mode === "guide" && finding.severity !== "note") {
              guided = yield* deliver(recorded, true).pipe(
                Effect.catch(() => Effect.succeed(false)),
              );
            }
          }
          yield* store.saveState({
            ...state,
            reviewedSequence: cursor,
            status: cursor < head ? "catching-up" : "watching",
            updatedAt: yield* now,
            reviewCount: state.reviewCount + 1,
            inputTokens: state.inputTokens + result.inputTokens,
            outputTokens: state.outputTokens + result.outputTokens,
            costUsd: state.costUsd + result.costUsd,
          });
          if (cursor < head) dirty.add(threadId);
        }),
      { concurrency: 3, discard: true },
    );
  });
  const enqueue = Effect.fn("Advisors.enqueue")(function* (
    threadId: ThreadId,
    sourceSequence?: number,
  ) {
    if (sourceSequence !== undefined && !initialCursors.has(threadId))
      initialCursors.set(threadId, Math.max(0, sourceSequence - 1));
    dirty.add(threadId);
    if (workers.has(threadId)) return;
    const run = Effect.gen(function* () {
      while (dirty.delete(threadId))
        yield* reviewThread(threadId).pipe(
          Effect.catch((cause) => Effect.logWarning("Advisor review unavailable", { cause })),
        );
    }).pipe(Effect.ensuring(Effect.sync(() => workers.delete(threadId))));
    const fiber = yield* Effect.forkIn(run, scope, { startImmediately: false });
    workers.set(threadId, fiber);
  });
  const save = Effect.fn("Advisors.save")(
    function* (input: AdvisorConfiguration) {
      if (
        new Set(input.definitions.map((definition) => definition.id)).size !==
          input.definitions.length ||
        (input.advisorIds !== null && new Set(input.advisorIds).size !== input.advisorIds.length)
      )
        return yield* fail("Choose each advisor only once.");
      yield* store.saveConfiguration(input);
      initialCursors.clear();
      const shell = yield* snapshots.getShellSnapshot();
      for (const thread of shell.threads) {
        if (input.scope.type === "thread" && input.scope.threadId !== thread.id) continue;
        if (
          input.scope.type !== "thread" &&
          thread.session?.status !== "running" &&
          !(yield* store.states(thread.id)).length
        )
          continue;
        if (input.scope.type === "project" && input.scope.projectId !== thread.projectId) continue;
        const running = workers.get(thread.id);
        if (running) yield* Fiber.interrupt(running);
        for (const state of yield* store.states(thread.id))
          yield* store.saveState({
            ...state,
            status: input.paused ? "paused" : "watching",
            reason: null,
            updatedAt: yield* now,
          });
        yield* enqueue(thread.id);
      }
    },
    Effect.mapError((cause) =>
      fail(isAdvisorError(cause) ? cause.message : "Could not save advisor settings."),
    ),
  );
  const action = Effect.fn("Advisors.action")(
    function* (input: AdvisorAction) {
      if (input.action === "address") {
        const finding = (yield* store.entries(input.threadId)).find(
          (value) => value.id === input.findingId && value.kind === "finding",
        );
        if (!finding) return yield* fail("This finding is no longer available.");
        yield* deliver(finding, false);
        return;
      }
      const configuration =
        (yield* store.configurations()).find(
          (value) => value.scope.type === "thread" && value.scope.threadId === input.threadId,
        ) ?? emptyAdvisorConfiguration({ type: "thread", threadId: input.threadId });
      yield* save({ ...configuration, paused: input.action === "pause" });
    },
    Effect.mapError((cause) =>
      fail(isAdvisorError(cause) ? cause.message : "Could not update advisors."),
    ),
  );
  const start = Effect.fn("Advisors.start")(function* () {
    if (started) return;
    started = true;
    const events = yield* engine.subscribeDomainEvents;
    yield* events.pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          if (event.aggregateKind !== "thread") return;
          const threadId = ThreadId.make(event.aggregateId);
          if (event.type === "thread.deleted") {
            guidedTurns.delete(threadId);
            initialCursors.delete(threadId);
            const worker = workers.get(threadId);
            if (worker) yield* Fiber.interrupt(worker);
            yield* store.removeThread(threadId).pipe(Effect.catch(() => Effect.void));
          } else if (
            event.type === "thread.activity-appended" &&
            event.payload.activity.kind === "provider.turn.start.failed"
          ) {
            const failure = yield* decodeDeliveryFailure(event.payload.activity.payload).pipe(
              Effect.option,
            );
            if (Option.isSome(failure) && failure.value.requestId.startsWith("advisor:")) {
              const findingId = failure.value.requestId.slice(8).split(":")[0];
              const finding = (yield* store.entries(threadId)).find(
                (entry) => entry.id === findingId,
              );
              if (finding)
                yield* store.append({
                  ...finding,
                  id: `${failure.value.requestId}:failed`,
                  kind: "error",
                  findingId: finding.id,
                  text: `Guidance was not delivered. ${failure.value.detail}`,
                  createdAt: yield* now,
                });
            }
          } else if (
            event.type === "thread.activity-appended" &&
            event.payload.activity.kind === "advisor.delivered"
          ) {
            const payload = yield* decodeDelivery(event.payload.activity.payload).pipe(
              Effect.option,
            );
            if (Option.isSome(payload)) {
              const finding = (yield* store.entries(threadId)).find(
                (entry) => entry.id === payload.value.findingId,
              );
              if (finding)
                yield* store.append({
                  ...finding,
                  id: `${finding.id}:delivered`,
                  kind: "delivery",
                  findingId: finding.id,
                  text: "Delivered to the agent",
                  createdAt: yield* now,
                });
            }
          } else if (advisorSourceText(event) !== null || event.type === "thread.session-set") {
            if (
              event.type === "thread.message-sent" &&
              event.payload.role === "assistant" &&
              !event.payload.streaming
            ) {
              const entries = yield* store.entries(threadId);
              const delivery = entries.findLast(
                (entry) => entry.kind === "delivery" && entry.text === "Delivered to the agent",
              );
              if (
                delivery?.findingId &&
                !entries.some((entry) => entry.id === `${delivery.findingId}:response`)
              ) {
                yield* store.append({
                  ...delivery,
                  id: `${delivery.findingId}:response`,
                  kind: "activity",
                  text: `Agent responded\n${event.payload.text.slice(0, 1_000)}`,
                  sourceSequence: event.sequence,
                  createdAt: yield* now,
                });
              }
            }
            yield* enqueue(threadId, event.sequence);
          }
        }),
      ),
      Effect.forkIn(scope),
    );
    for (const state of yield* store.states()) {
      if (state.status === "reviewing" || state.status === "catching-up")
        yield* store.saveState({ ...state, status: "watching", updatedAt: yield* now });
      if (state.status !== "paused" && state.status !== "unavailable")
        yield* enqueue(state.threadId);
    }
  });
  return {
    start,
    save,
    action,
    subscribe: store.subscribe,
    drain: Effect.suspend(() =>
      Effect.forEach([...workers.values()], Fiber.await, { discard: true }),
    ),
  };
});
export class Advisors extends Context.Service<Advisors, Effect.Success<typeof make>>()(
  "t3/advisors/Advisors",
) {}
export const layer = Layer.effect(Advisors, make);
