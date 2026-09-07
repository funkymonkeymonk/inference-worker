import assert from "node:assert/strict";
import test from "node:test";
import { request } from "node:http";
import { createUiServer } from "./server.js";

function get(port: number, path: string): Promise<{ status: number; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => body += chunk);
      response.on("end", () => resolve({ status: response.statusCode ?? 0, type: String(response.headers["content-type"]), body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("serves overview JSON and the read-only page", async (t) => {
  const server = createUiServer({
    getOverview: async () => ({ items: [], dispatcher: undefined, refreshedAt: "now", errors: [] }),
    getWorkItem: async () => undefined,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const overview = await get(address.port, "/api/overview");
  assert.equal(overview.status, 200);
  assert.match(overview.type, /application\/json/);
  assert.deepEqual(JSON.parse(overview.body), { items: [], refreshedAt: "now", errors: [] });

  const page = await get(address.port, "/");
  assert.equal(page.status, 200);
  assert.match(page.type, /text\/html/);
  assert.match(page.body, /Work Item Monitor/);
});

test("serves a work-item detail response", async (t) => {
  const server = createUiServer({
    getOverview: async () => ({ items: [], refreshedAt: "now", errors: [] }),
    getWorkItem: async (id) => id === "yak/1" ? { taskId: id, title: "Task", workflowId: "work-item-yak/1", history: [] } : undefined,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const detail = await get(address.port, "/api/work-items/yak%2F1");
  assert.equal(detail.status, 200);
  assert.deepEqual(JSON.parse(detail.body), { taskId: "yak/1", title: "Task", workflowId: "work-item-yak/1", history: [] });
});

test("returns not found for unknown resources", async (t) => {
  const server = createUiServer({ getOverview: async () => ({ items: [], refreshedAt: "now", errors: [] }), getWorkItem: async () => undefined });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  assert.equal((await get(address.port, "/nope")).status, 404);
});
