import assert from "node:assert/strict";
import { once } from "node:events";
import { after, test } from "node:test";

process.env.PORT = "0";
const { server } = await import("./index.js");
if (!server.listening) await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("Test server did not bind");
const base = `http://127.0.0.1:${address.port}/api`;
after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));

test("API rejects foreign origins without calling providers", async () => {
  const response = await fetch(`${base}/health`, { headers: { origin: "https://other.example" } });
  assert.equal(response.status, 403); assert.match((await response.json()).error, /origin/i);
});
test("malformed and oversized JSON have safe JSON errors", async () => {
  for (const [body, expected] of [["{", 400], [JSON.stringify({ text: "x".repeat(2_100_000) }), 413]] as const) {
    const response = await fetch(`${base}/voice/transcribe`, { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.equal(response.status, expected); assert.equal(typeof (await response.json()).error, "string");
  }
});
test("voice and turn payloads are validated before provider requests", async () => {
  for (const [endpoint, body] of [["voice/transcribe", { base64: "not audio", mimeType: "text/html" }], ["voice/stream", { text: " ", speaker: "caller" }], ["turns/resolve", { transcript: " " }]]) {
    const response = await fetch(`${base}/${endpoint}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(response.status, 400); assert.equal(typeof (await response.json()).error, "string");
  }
});
test("unknown API paths never return the SPA HTML", async () => {
  const response = await fetch(`${base}/unknown`); assert.equal(response.status, 404);
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  assert.equal((await response.json()).error, "Unknown API endpoint");
});
