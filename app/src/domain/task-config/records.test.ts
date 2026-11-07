import { describe, expect, it } from "vitest";
import "../../test/fixtures";
import { DEFAULT_DRAFT } from "./types";
import { chooseAlgorithm, chooseTaskType } from "./selection";

describe("application experience configuration", () => {
  it("chooses application before algorithm and clears incompatible inputs", () => {
    const application = chooseTaskType(DEFAULT_DRAFT, "medical-records");
    expect(application.taskType).toBe("medical-records");
    expect(application.algorithm).toBeNull();
    const selected = chooseAlgorithm(application, "evomedclaw-records");
    expect(selected.execution).toBe("builtin");
    expect(selected.rounds).toBe(1);
    const changed = chooseTaskType({...selected, clientModel:"default", participants:[{participantId:"p", datasetId:"d"}]}, "math-records");
    expect(changed.algorithm).toBeNull();
    expect(changed.participants).toEqual([]);
    expect(changed.clientModel).toBe("");
  });
  it("can clear the application and choose FoT for either application", () => {
    const selected = chooseAlgorithm(chooseTaskType(DEFAULT_DRAFT, "medical-records"), "fot-records");
    const math = chooseTaskType(selected, "math-records");
    expect(math.algorithm).toBe("fot-records");
    const cleared = chooseTaskType(math, null);
    expect(cleared.taskType).toBeNull();
    expect(cleared.algorithm).toBeNull();
  });
});
