import { describe, expect, it } from "vitest";
import {
  PARTITIONS,
  PROTECTIONS,
  TOPOLOGIES,
  WORKLOADS,
  configurationFor,
  isConfigurationReady,
  workloadOf,
} from "./configuration";

describe("federation configuration registry", () => {
  it("contains the complete set of product dimensions", () => {
    expect(WORKLOADS.map((item) => item.id)).toEqual([
      "model-training",
      "peft",
      "vertical-modeling",
      "federated-evaluation",
      "federated-analytics",
      "fedrag",
      "personalized",
      "heterogeneous-models",
      "agent-skill",
    ]);
    expect(PARTITIONS).toHaveLength(4);
    expect(TOPOLOGIES).toHaveLength(4);
    expect(PROTECTIONS).toHaveLength(6);
  });

  it("gives every workload a complete, valid default configuration", () => {
    for (const workload of WORKLOADS) {
      const configuration = configurationFor(workload.id);
      expect(isConfigurationReady(configuration)).toBe(true);
      expect(workload.strategies.length).toBeGreaterThan(0);
      expect(workload.settings.length).toBeGreaterThan(0);
      expect(workload.runner).toBeTruthy();
      expect(workload.output).toBeTruthy();
    }
  });

  it("keeps method-specific choices scoped to the selected workload", () => {
    expect(workloadOf("peft").strategies.map((item) => item.id)).toEqual([
      "fedavg", "fedprox", "fedadam",
    ]);
    expect(workloadOf("fedrag").strategies.map((item) => item.id)).toEqual([
      "score-merge", "rrf", "secure-rerank",
    ]);
    expect(workloadOf("vertical-modeling").runner).toBe("FATE");
  });
});
