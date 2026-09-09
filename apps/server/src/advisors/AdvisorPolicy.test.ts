import { describe, expect, it } from "vite-plus/test";
import {
  ProjectId,
  EventId,
  MessageId,
  ProviderInstanceId,
  ThreadId,
  emptyAdvisorConfiguration,
  type AdvisorDefinition,
} from "@t3tools/contracts";
import { advisorSourceText, resolveAdvisors } from "./AdvisorPolicy.ts";
const thread = { id: ThreadId.make("thread"), projectId: ProjectId.make("project") };
const definition: AdvisorDefinition = {
  id: "quality",
  name: "Quality",
  modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "sonnet" },
  instructions: "Review correctness",
  mode: "guide",
};
describe("advisor inheritance", () => {
  it("inherits environment selection and combines project guidance", () => {
    const result = resolveAdvisors(
      [
        {
          ...emptyAdvisorConfiguration({ type: "environment" }),
          definitions: [definition],
          advisorIds: [definition.id],
        },
        {
          ...emptyAdvisorConfiguration({ type: "project", projectId: thread.projectId }),
          instructions: "Check remote clients",
        },
      ],
      thread,
    );
    expect(result.definitions).toEqual([definition]);
    expect(result.layers.map((layer) => layer.instructions)).toContain("Check remote clients");
  });
  it("treats an empty thread selection as disabled, not inherited", () => {
    const result = resolveAdvisors(
      [
        {
          ...emptyAdvisorConfiguration({ type: "environment" }),
          definitions: [definition],
          advisorIds: [definition.id],
        },
        { ...emptyAdvisorConfiguration({ type: "thread", threadId: thread.id }), advisorIds: [] },
      ],
      thread,
    );
    expect(result.definitions).toEqual([]);
  });
  it("preserves a project pause even if the thread is resumed", () => {
    const result = resolveAdvisors(
      [
        {
          ...emptyAdvisorConfiguration({ type: "project", projectId: thread.projectId }),
          paused: true,
        },
        emptyAdvisorConfiguration({ type: "thread", threadId: thread.id }),
      ],
      thread,
    );
    expect(result.paused).toBe(true);
  });
});

describe("advisor review input", () => {
  const createdAt = "2026-09-09T00:00:00.000Z";
  const base = {
    sequence: 1,
    eventId: EventId.make("activity"),
    aggregateKind: "thread" as const,
    aggregateId: thread.id,
    occurredAt: createdAt,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
  };
  for (const kind of ["context-window.updated", "checkpoint.captured"]) {
    it(`does not review ${kind} bookkeeping`, () => {
      expect(
        advisorSourceText({
          ...base,
          type: "thread.activity-appended",
          payload: {
            threadId: thread.id,
            activity: {
              id: EventId.make("activity"),
              tone: "info",
              kind,
              summary: "Bookkeeping update",
              payload: {},
              turnId: null,
              createdAt,
            },
          },
        }),
      ).toBeNull();
    });
  }
  it("ignores empty assistant completions", () => {
    expect(
      advisorSourceText({
        ...base,
        type: "thread.message-sent",
        payload: {
          threadId: thread.id,
          messageId: MessageId.make("empty"),
          role: "assistant",
          text: " \n",
          turnId: null,
          streaming: false,
          createdAt,
          updatedAt: createdAt,
        },
      }),
    ).toBeNull();
  });
  it("retains tool results as evidence", () => {
    expect(
      advisorSourceText({
        ...base,
        type: "thread.activity-appended",
        payload: {
          threadId: thread.id,
          activity: {
            id: EventId.make("activity"),
            tone: "info",
            kind: "tool.completed",
            summary: "Read adult.js",
            payload: { output: "age > 18" },
            turnId: null,
            createdAt,
          },
        },
      }),
    ).toContain("age > 18");
  });
});
