#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { TurnResolutionSchema } from "../../../shared/contracts.ts";

const path = process.argv[2];
if (!path) {
  console.error("usage: node validate-turn.mjs <turn.json>");
  process.exit(2);
}

const value = JSON.parse(await readFile(path, "utf8"));
const valid = TurnResolutionSchema.safeParse(value).success;

if (!valid) {
  console.error("invalid TurnResolution");
  process.exit(1);
}
console.log("valid TurnResolution");
