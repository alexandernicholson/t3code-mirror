import { describe, expect, it } from "vite-plus/test";
import { ProjectId, ThreadId } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import {
  advisorDefinitionsForScope,
  emptyAdvisorConfiguration,
  inheritedAdvisorIds,
  setAdvisorDefinition,
  type AdvisorDefinition,
} from "./advisors.ts";

const projectId = ProjectId.make("project");
const scope = { type: "thread", threadId: ThreadId.make("thread") } as const;
const definition: AdvisorDefinition = {
  id: "reviewer",
  name: "Reviewer",
  instructions: "Check correctness",
  mode: "observe",
  modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "claude-fable-5-1" },
};
const environment = {
  ...emptyAdvisorConfiguration({ type: "environment" }),
  definitions: [definition],
  advisorIds: [definition.id],
};

describe("advisor model selection by scope", () => {
  it("saves an inherited model override only for the selected thread, including its options", () => {
    const local = setAdvisorDefinition(emptyAdvisorConfiguration(scope), {
      ...definition,
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5",
        options: [{ id: "reasoningEffort", value: "low" }],
      },
    });
    const configurations = [environment, local];
    expect(advisorDefinitionsForScope(configurations, scope, projectId)).toEqual(local.definitions);
    expect(
      advisorDefinitionsForScope(
        configurations,
        { type: "thread", threadId: ThreadId.make("other") },
        projectId,
      ),
    ).toEqual([definition]);
    expect(inheritedAdvisorIds(configurations, scope, projectId)).toEqual([definition.id]);
    expect(local.advisorIds).toBeNull();
    expect(local.definitions[0]?.instructions).toBe(definition.instructions);
  });

  it("uses the project's model again when a thread override is removed", () => {
    const project = setAdvisorDefinition(
      emptyAdvisorConfiguration({ type: "project", projectId }),
      {
        ...definition,
        modelSelection: { ...definition.modelSelection, model: "claude-sonnet-5" },
      },
    );
    const local = setAdvisorDefinition(emptyAdvisorConfiguration(scope), definition);
    expect(advisorDefinitionsForScope([environment, project, local], scope, projectId)).toEqual([
      definition,
    ]);
    expect(
      advisorDefinitionsForScope(
        [environment, project, { ...local, definitions: [] }],
        scope,
        projectId,
      ),
    ).toEqual(project.definitions);
  });

  it("updates a locally created advisor without duplicating it or altering other settings", () => {
    const local = {
      ...emptyAdvisorConfiguration(scope),
      revision: 3,
      advisorIds: [definition.id],
      paused: true,
    };
    const updated = setAdvisorDefinition(setAdvisorDefinition(local, definition), {
      ...definition,
      name: "Observer",
    });
    expect(updated.definitions).toHaveLength(1);
    expect(updated.definitions[0]?.name).toBe("Observer");
    expect(updated).toMatchObject({ revision: 3, advisorIds: [definition.id], paused: true });
  });
});
