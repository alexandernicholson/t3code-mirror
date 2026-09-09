import { describe, expect, it } from "vite-plus/test";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  emptyAdvisorConfiguration,
  type AdvisorDefinition,
} from "@t3tools/contracts";
import { resolveAdvisors } from "./AdvisorPolicy.ts";
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
