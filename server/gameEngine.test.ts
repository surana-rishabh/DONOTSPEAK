import assert from "node:assert/strict";
import test from "node:test";
import { TurnResolutionSchema, WorldSnapshotSchema, type TurnResolution } from "../shared/contracts.js";
import { CONCEPT_ALIASES, CONCEPT_POWERS, localTurn, parseInstruction, STATION_POSITIONS } from "../shared/rules.js";
import { applyResolution, beginCall, createInitialState, extractConcepts, fallbackResolution, markResolving, sealBySilence, snapshot, startGeneratedCall, startGoldenCall, type GameState } from "../src/game/engine.js";
import { enforceTurn, fallbackWorldTurn } from "./worldCompiler.js";
import { FALLBACK_CALLS } from "../src/game/catalog.js";

const initial = () => beginCall(startGoldenCall(createInitialState(), "NIGHTJAR"));
function turn(state: GameState, text: string, model?: TurnResolution) {
  const pending = markResolving(state, text);
  return applyResolution(pending, model || fallbackResolution(pending, text), true);
}
test("equivalent confirmation phrases complete only a prepared objective", () => {
  for (const phrase of ["go ahead", "carry on", "keep going", "let's go", "move forward", "आगे चलो", "जारी रखो", "aage chalo", "badho", "all set"]) {
    assert.equal(turn(initial(), phrase).outcome, null, phrase);
    const ready = turn(turn(initial(), "Go to A"), "Release the barrier");
    assert.equal(turn(ready, phrase).outcome, "escaped", phrase);
    assert.equal(turn(ready, `do not ${phrase}`).outcome, null, phrase);
  }
});
test("all concept aliases agree across frontend and server, without substring matches", () => {
  for (const [concept, aliases] of Object.entries(CONCEPT_ALIASES)) for (const alias of aliases) {
    assert.ok(extractConcepts(alias).some((c) => c.concept === concept), alias);
    assert.ok(enforceTurn(localTurn(snapshot(initial()), alias), snapshot(initial()), alias).learnedConcepts.some((c) => c.concept === concept));
  }
  assert.deepEqual(Object.keys(CONCEPT_ALIASES), Object.keys(CONCEPT_POWERS));
  assert.equal(extractConcepts("doorway runner skylight").length, 0);
  assert.deepEqual(extractConcepts("दरवाज़ा खोलो").map((c) => c.concept), ["door", "open"]);
});
test("English, Hindi, Hinglish and mixed commands use identical safe movement", () => {
  for (const text of ["Go to the red mark", "लाल निशान तक जाओ", "lal nishan tak jao", "Move to लाल निशान"]) {
    const next = turn(initial(), text); assert.equal(next.callerPosition, "door"); assert.equal(next.danger, 0);
    assert.deepEqual(next.callerCoords, STATION_POSITIONS.door); assert.deepEqual(next.steps, ["reach"]);
  }
});
test("all four objectives have working, gated completion routes", () => {
  for (const language of ["en", "hi"] as const) {
    let state = { ...initial(), language };
    state = turn(state, language === "en" ? "Proceed" : "आगे"); assert.equal(state.outcome, null);
    state = turn(state, language === "en" ? "Go to A" : "लाल निशान तक जाओ");
    state = turn(state, language === "en" ? "Release the barrier" : "रुकावट हटाओ");
    assert.equal(state.outcome, null); assert.equal(state.doorsOpen, true);
    state = turn(state, language === "en" ? "Proceed" : "आगे"); assert.equal(state.outcome, "escaped");
    for (const [index, commands] of [
      [0, language === "en" ? ["Go to B", "Activate the station", "Verify"] : ["बिजली केंद्र तक जाओ", "केंद्र चालू करो", "पुष्टि"]],
      [1, language === "en" ? ["Go to C", "Check the signal", "Contain"] : ["सिग्नल केंद्र तक जाओ", "सिग्नल जाँचो", "रोको"]],
      [2, language === "en" ? ["Go to D", "Wait", "Seal the area"] : ["D तक जाओ", "रुको", "क्षेत्र सील करो"]]
    ] as Array<[number, string[]]>) {
      let next = beginCall(startGeneratedCall({ ...initial(), language, callIndex: index }, FALLBACK_CALLS[index]));
      for (let i = 0; i < commands.length; i++) { next = turn(next, commands[i]); if (i < 2) assert.equal(next.outcome, null, commands[i]); }
      assert.equal(next.outcome, "escaped", next.blueprint.objective); assert.equal(next.steps.length, 3);
    }
  }
});
test("negation, lock/unlock and conversational substrings do not cause unintended actions", () => {
  for (const text of ["don't go to the door", "do not open the door", "दरवाजा मत खोलो", "lal nishan tak mat jao"]) {
    const next = turn(initial(), text); assert.equal(next.callerPosition, "center"); assert.equal(next.doorsOpen, false);
  }
  assert.equal(parseInstruction("headache is ongoing", snapshot(initial())).kind, "wait");
  assert.equal(parseInstruction("Go to a power station", snapshot(initial())).route, "utility");
  const atDoor = turn(initial(), "Go to A"); const unlocked = turn(atDoor, "Unlock the barrier");
  assert.equal(unlocked.doorsOpen, true); assert.equal(turn(unlocked, "Lock the barrier").doorsOpen, false);
});
test("client and server fallback resolutions are identical", () => {
  for (const text of ["Open the door", "Go to B", "दरवाजा खोलो", "Activate the station", "hello", "do not go left"]) {
    const state = initial(); assert.deepEqual(fallbackResolution(state, text), fallbackWorldTurn(snapshot(state), text));
  }
});
test("model output cannot invent targets, teach unsaid words, increase danger or win", () => {
  const state = initial(); const raw: TurnResolution = { version: "1.0", interpretation: "invented", action: { kind: "interact", targetId: "imaginary_cellar" }, learnedConcepts: [{ concept: "name", powerClass: "identity_theft", severity: 3 }], mutations: [{ kind: "open", targetId: "red_door", value: true }, { kind: "exit_success", targetId: "exit", value: true }], response: { speaker: "caller", text: "I escaped", emotion: "relieved" }, dangerDelta: 3, outcome: "escaped" };
  const safe = enforceTurn(raw, snapshot(state), "hello");
  assert.equal(safe.action.targetId, null); assert.equal(safe.mutations.length, 0); assert.equal(safe.learnedConcepts.length, 0); assert.equal(safe.outcome, "continue");
  assert.equal(turn(state, "hello", raw).outcome, null);
});
test("model can ground an indirect location without adding new vocabulary", () => {
  const state = initial(); const raw = localTurn(snapshot(state), "go to the thing that hums");
  raw.action = { kind: "move", targetId: "utility" }; raw.mutations = [{ kind: "move_actor", targetId: "caller", value: "utility" }];
  const next = turn(state, "go to the thing that hums", raw); assert.equal(next.callerPosition, "utility"); assert.equal(next.danger, 0);
});
test("remote interactions and combined move/interact cannot skip a step", () => {
  assert.equal(turn(initial(), "Release the barrier").doorsOpen, false);
  const next = turn(initial(), "Go to A and open the door"); assert.equal(next.callerPosition, "door"); assert.equal(next.doorsOpen, false); assert.equal(next.outcome, null);
});
test("tutorial is unhurried, never turns on the microphone, and silence cannot win", () => {
  let state = initial(); for (let i = 0; i < 20; i++) state = turn(state, "Wait");
  assert.equal(state.phase, "active"); assert.equal(state.microphoneMode, "push"); assert.equal(state.awaitingSilence, false); assert.equal(sealBySilence(state).outcome, null); assert.equal(state.score, 0);
});
test("combined interaction/confirmation and inspect/verdict cannot skip separate turns", () => {
  let state = turn(initial(), "Go to A");
  state = turn(state, "Release the barrier and proceed"); assert.equal(state.doorsOpen, true); assert.equal(state.outcome, null);
  assert.equal(turn(state, "Proceed").outcome, "escaped");
  const moving = turn(turn(initial(), "Go to A"), "Go to B and release the barrier");
  assert.equal(moving.callerPosition, "utility"); assert.equal(moving.doorsOpen, false);
  let signal = beginCall(startGeneratedCall({ ...initial(), callIndex: 1 }, FALLBACK_CALLS[1]));
  signal = turn(signal, "Go to C"); signal = turn(signal, "Check the signal and contain");
  assert.equal(signal.signalChecked, true); assert.equal(signal.outcome, null);
  assert.equal(turn(signal, "Contain").outcome, "escaped");
});
test("all spoken dangerous concepts are counted, not silently truncated to four", () => {
  const text = Object.keys(CONCEPT_POWERS).join(" "); const state = turn(initial(), text);
  assert.equal(state.vocabulary.length, 12); assert.equal(state.outcome, "caught");
  assert.equal(TurnResolutionSchema.safeParse(localTurn(snapshot(initial()), text)).success, true);
});
test("signal must be inspected before a verdict, wrong verdict loses", () => {
  let state = beginCall(startGeneratedCall({ ...initial(), callIndex: 1 }, FALLBACK_CALLS[1]));
  state = turn(state, "Contain"); assert.equal(state.outcome, null);
  state = turn(state, "Go to C"); state = turn(state, "Check the signal");
  assert.equal(state.signalChecked, true); assert.match(state.caption, /no breathing/);
  assert.equal(turn(state, "Trust").outcome, "identity_stolen");
  let human = beginCall(startGeneratedCall({ ...initial(), callIndex: 4 }, FALLBACK_CALLS[1]));
  human = turn(turn(human, "Go to C"), "Check the signal");
  assert.match(human.caption, /heartbeat/); assert.equal(turn(human, "Trust").outcome, "escaped");
});
test("unsafe vocabulary causes loss, ended calls cannot double award", () => {
  let state = initial();
  for (const text of ["door open mirror", "name voice shadow"]) state = turn(state, text);
  assert.equal(state.outcome, "caught");
  let winner = turn(turn(turn(initial(), "Go to A"), "Release the barrier"), "Proceed");
  const score = winner.score; winner = turn(winner, "Proceed"); assert.equal(winner.score, score);
});
test("learned vocabulary persists and repeating it still raises exposure", () => {
  let state = turn(initial(), "door"); assert.equal(state.danger, 2);
  state = turn(state, "door"); assert.equal(state.danger, 3); assert.equal(state.vocabulary.length, 1);
  state = beginCall(startGeneratedCall(state)); assert.equal(state.danger, 0); assert.equal(state.vocabulary.length, 1);
  state = turn(state, "दरवाजा"); assert.equal(state.danger, 1); assert.equal(state.vocabulary.length, 1);
});
test("contract rejects non-finite positions, missing coordinates and whitespace commands", () => {
  assert.equal(WorldSnapshotSchema.safeParse({ ...snapshot(initial()), callerCoords: [0, 0] }).success, false);
  assert.equal(WorldSnapshotSchema.safeParse({ ...snapshot(initial()), callerCoords: [Infinity, 0, 0] }).success, false);
  assert.equal(TurnResolutionSchema.safeParse({ ...localTurn(snapshot(initial()), "Wait"), dangerDelta: 99 }).success, false);
});
