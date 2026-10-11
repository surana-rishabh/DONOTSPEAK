import assert from "node:assert/strict";
import { createServer } from "node:http";

process.env.VERCEL = "1";
const { default: app } = await import("../api/index.ts");
const { server } = await import("../server/index.ts");
assert.equal(server.listening, false, "Serverless import must not bind a port");
const testServer = createServer(app);
await new Promise(resolve => testServer.listen(0, "127.0.0.1", resolve));
try {
  const origin = `http://127.0.0.1:${testServer.address().port}`;
  const health = await fetch(`${origin}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
  const missing = await fetch(`${origin}/api/not-an-endpoint`);
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get("content-type"), /json/);
  console.log(JSON.stringify({ ok: true, serverlessExport: true, noPortBinding: true, apiRouting: true }));
} finally { await new Promise(resolve => testServer.close(resolve)); }
