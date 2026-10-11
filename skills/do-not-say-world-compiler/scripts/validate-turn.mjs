#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const path = process.argv[2];
if (!path) {
  console.error("usage: node validate-turn.mjs <turn.json>");
  process.exit(2);
}

const value = JSON.parse(await readFile(path, "utf8"));
const actions = new Set(["move", "inspect", "interact", "wait", "refuse"]);
const outcomes = new Set(["continue", "escaped", "caught", "identity_stolen"]);
const mutations = new Set(["open", "close", "power_on", "power_off", "reveal", "hide", "move_actor", "spawn_shadow", "swap_voice", "camera_blackout", "exit_success", "caller_caught"]);
const valid = value?.version === "1.0"
  && actions.has(value?.action?.kind)
  && Array.isArray(value?.learnedConcepts)
  && Array.isArray(value?.mutations)
  && value.mutations.every((item) => mutations.has(item?.kind) && typeof item?.targetId === "string")
  && Number.isInteger(value?.dangerDelta) && value.dangerDelta >= -2 && value.dangerDelta <= 3
  && outcomes.has(value?.outcome)
  && typeof value?.response?.text === "string";

if (!valid) {
  console.error("invalid TurnResolution");
  process.exit(1);
}
console.log("valid TurnResolution");
