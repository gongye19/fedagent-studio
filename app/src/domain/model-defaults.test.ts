import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "../test/fixtures";
import { DEFAULT_DRAFT, chooseAlgorithm, chooseTaskType, withDefaults } from "./config";
import { platformModelRef, selectedModelRef, type Endpoint } from "./resources";
import { decodeDraft } from "../state/draft";
import { reducer } from "../state/store";

const platform: Endpoint = { ...ENDPOINTS[0], configured: true, verified: true, models: ["platform-model"] };
const personal: Endpoint = { ...platform, id: "own", builtin: false, resourceSpace: "workspace", models: ["own-model"] };

describe("platform model defaults", () => {
  it("migrates unversioned empty drafts while preserving versioned explicit clear", () => {
    const legacy = decodeDraft(JSON.stringify({clientModel:"", serverModel:"", touched:true}));
    expect([legacy.clientModel, legacy.serverModel]).toEqual(["default", "default"]);
    const cleared = decodeDraft(JSON.stringify({selectionVersion:2,clientModel:"",serverModel:"",touched:true}));
    expect([cleared.clientModel, cleared.serverModel]).toEqual(["", ""]);
  });
  it("uses only a verified available platform model, independent of list order or loading", () => {
    expect(platformModelRef([])).toBe("");
    expect(platformModelRef([personal])).toBe("");
    expect(platformModelRef([personal, platform])).toBe("default");
    expect(platformModelRef([{...platform, verified: false}, personal])).toBe("");
    expect(platformModelRef([{...platform, configured: false}, personal])).toBe("");
    expect(platformModelRef([{...platform, shared: false}, personal])).toBe("");
    expect(selectedModelRef(undefined, [])).toBe("");
    expect(selectedModelRef(undefined, [personal, platform])).toBe("default");
  });
  it("respects custom selections, explicit clear and unavailable custom models", () => {
    expect(selectedModelRef("own:own-model", [platform, personal])).toBe("own:own-model");
    expect(selectedModelRef("", [platform, personal])).toBe("");
    expect(selectedModelRef("own:own-model", [platform])).toBe("");
    expect(selectedModelRef("own:own-model", [platform, {...personal, verified:false}])).toBe("");
  });
  it("starts and resets task model roles to the platform without preselecting data or algorithms", () => {
    const fresh = reducer(withDefaults({clientModel:"own:own-model", serverModel:"own:own-model"}), {type:"resetDraft"}, []);
    expect([fresh.clientModel, fresh.serverModel, fresh.algorithm, fresh.participants]).toEqual(["default", "default", null, []]);
    const chosen = chooseTaskType(chooseAlgorithm(DEFAULT_DRAFT, "fot-records"), "medical-records");
    expect([chosen.clientModel, chosen.serverModel]).toEqual(["default", "default"]);
    const cleared = reducer(chosen, {type:"updateDraft",patch:{clientModel:"",serverModel:""}}, []);
    expect(reducer(cleared, {type:"updateDraft",patch:{name:"新名称"}}, []).clientModel).toBe("");
    const copied = reducer(fresh, {type:"resetDraft", draft:{clientModel:"own:own-model",serverModel:"own:own-model"}}, []);
    expect([copied.clientModel, copied.serverModel]).toEqual(["own:own-model", "own:own-model"]);
  });
});
