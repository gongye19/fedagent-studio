import { describe, expect, it } from "vitest";
import { initialState, recipeOf, reducer } from "./store";

describe("configuration state", () => {
  it("requires the three common choices and method-specific configuration", () => {
    const ready = initialState;

    expect(recipeOf(ready)).not.toBeNull();
    expect(recipeOf({ ...ready, federationMethodId: null })).toBeNull();
    expect(recipeOf({ ...ready, dataTypeId: null })).toBeNull();
    expect(recipeOf({ ...ready, baseModelId: null })).toBeNull();
    expect(recipeOf({ ...ready, rankId: null })).toBeNull();
  });

  it("binds the registered sample inputs when the data type is selected", () => {
    const next = reducer({ ...initialState, artifactIds: [] }, { type: "setDataType", id: "lora" });

    expect(next.artifactIds).toEqual(["news-summary", "legal-qa", "finance-report"]);
  });

  it("rebinds compatible samples when LoRA-specific settings change", () => {
    const cleared = { ...initialState, artifactIds: [] };
    const modelBound = reducer(cleared, { type: "setBaseModel", id: "llama-3.1-8b" });
    const rankBound = reducer(cleared, { type: "setRank", id: "16" });

    expect(modelBound.artifactIds).toEqual(["news-summary", "legal-qa", "finance-report"]);
    expect(rankBound.artifactIds).toEqual(["news-summary", "legal-qa", "finance-report"]);
  });

  it("stages an uploaded artifact and selects it for the run", () => {
    const artifact = {
      ...initialState.artifacts[0],
      id: "upload-research-adapter",
      name: "Research adapter",
      owner: "me" as const,
    };
    const next = reducer(initialState, { type: "stageArtifact", artifact });

    expect(next.artifacts[0]).toEqual(artifact);
    expect(next.artifactIds).toContain(artifact.id);
  });
});
