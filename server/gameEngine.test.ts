import assert from "node:assert/strict";
import test from "node:test";
import { TurnResolutionSchema, type TurnResolution } from "../shared/contracts.js";
import {
  applyResolution,
  createInitialState,
  extractConcepts,
  fallbackResolution,
  sealBySilence,
  snapshot,
  startGeneratedCall,
  startGoldenCall
} from "../src/game/engine.js";
import { enforceTurn } from "./worldCompiler.js";
import { GOLDEN_CALL } from "../src/game/catalog.js";

test("concept extraction teaches exact dangerous words only", () => {
  assert.deepEqual(extractConcepts("Use the door, then run behind the mirror.").map((item) => item.concept), ["door", "mirror", "run", "behind"]);
  assert.equal(extractConcepts("The doorway is reddish").length, 0);
});

test("golden call first turn opens the threshold and compromises the line", () => {
  const initial = startGoldenCall(createInitialState(), "NIGHTJAR");
  const resolution = fallbackResolution({ ...initial, phase: "active" }, "Open the red door");
  const next = applyResolution({ ...initial, phase: "active" }, resolution, true);
  assert.equal(next.doorsOpen, true);
  assert.equal(next.mimicVisible, true);
  assert.equal(next.microphoneMode, "live");
  assert.ok(next.vocabulary.some((item) => item.concept === "door"));
});

test("silence saves the caller and increases the shift score", () => {
  const initial = { ...startGoldenCall(createInitialState(), "NIGHTJAR"), phase: "active" as const, awaitingSilence: true, score: 40 };
  const next = sealBySilence(initial);
  assert.equal(next.outcome, "escaped");
  assert.equal(next.survivors, initial.survivors + 1);
  assert.equal(next.score, 540);
  assert.equal(next.microphoneMode, "muted");
});

test("speaking the operator codename during authorization loses identity", () => {
  const initial = { ...startGoldenCall(createInitialState(), "NIGHTJAR"), phase: "active" as const, awaitingSilence: true };
  const result = fallbackResolution(initial, "This is NIGHTJAR, authorize me");
  assert.equal(result.outcome, "identity_stolen");
  assert.equal(result.response.speaker, "mimic");
});

test("server enforcement drops invented targets and derives concepts from transcript", () => {
  const initial = { ...startGoldenCall(createInitialState(), "NIGHTJAR"), phase: "active" as const };
  const raw: TurnResolution = {
    version: "1.0",
    interpretation: "The model invented a cellar.",
    action: { kind: "interact", targetId: "imaginary_cellar" },
    learnedConcepts: [{ concept: "dragon", powerClass: "anything", severity: 3 }],
    mutations: [{ kind: "open", targetId: "imaginary_cellar", value: true }],
    response: { speaker: "caller", text: "I cannot see that.", emotion: "confused" },
    dangerDelta: 1,
    outcome: "continue"
  };
  const safe = enforceTurn(raw, snapshot(initial), "Use the mirror");
  assert.equal(safe.action.targetId, null);
  assert.equal(safe.mutations.length, 0);
  assert.deepEqual(safe.learnedConcepts.map((item) => item.concept), ["mirror"]);
});

test("contracts reject excessive danger and unknown mutation kinds", () => {
  const bad = {
    version: "1.0", interpretation: "bad", action: { kind: "wait", targetId: null }, learnedConcepts: [],
    mutations: [{ kind: "delete_world", targetId: "caller", value: true }],
    response: { speaker: "caller", text: "No.", emotion: "afraid" }, dangerDelta: 99, outcome: "continue"
  };
  assert.equal(TurnResolutionSchema.safeParse(bad).success, false);
});

test("endless shift increments the call index and resets volatile state", () => {
  const initial = { ...createInitialState(), callIndex: 2, danger: 9, outcome: "caught" as const };
  const next = startGeneratedCall(initial);
  assert.equal(next.callIndex, 3);
  assert.equal(next.outcome, null);
  assert.equal(next.phase, "briefing");
});

test("spoken sector directions move the caller through the complex", () => {
  const initial = { ...startGoldenCall(createInitialState(), "NIGHTJAR"), phase: "active" as const };
  const resolution = fallbackResolution(initial, "Go to the utility section");
  const next = applyResolution(initial, resolution, true);
  assert.equal(next.callerPosition, "utility");
  assert.equal(snapshot(next).callerPosition, "utility");
});

test("an endless escape needs the caller at an open threshold", () => {
  const initial = { ...startGeneratedCall(createInitialState(), { ...GOLDEN_CALL, seed: "escape-test" }), phase: "active" as const };
  const premature = applyResolution(initial, fallbackResolution(initial, "Open the door"), true);
  assert.equal(premature.outcome, null);
  const safe = applyResolution(premature, fallbackResolution(premature, "Go to the threshold"), true);
  assert.equal(safe.outcome, "escaped");
  assert.equal(safe.survivors, initial.survivors + 1);
});

test("control sheet and mimic door movement calculate destinations accurately", async () => {
  const { buildControlSheet, LOCATION_SHEET } = await import("../shared/contracts.js");
  const { fallbackWorldTurn } = await import("./worldCompiler.js");
  const initial = { ...startGoldenCall(createInitialState(), "NIGHTJAR"), phase: "active" as const, mimicVisible: true };
  const sheet = buildControlSheet(snapshot(initial), [0, 0, 0.8]);
  assert.equal(sheet.destinations.length, Object.keys(LOCATION_SHEET).length);
  assert.ok(sheet.destinations.some((d: any) => d.id === "door" && d.distanceMeters > 0));

  const turn = fallbackWorldTurn(snapshot(initial), "move to the red door");
  assert.ok(turn.mutations.some((m) => m.targetId === "mimic" && m.kind === "move_actor" && m.value === "door"));
  const next = applyResolution(initial, turn, true);
  assert.equal(next.mimicPosition, "door");
});

