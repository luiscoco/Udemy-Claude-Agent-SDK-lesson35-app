import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Inbox } from "./queue.js";
import { applyControl, registerControls, activeCount } from "./controls.js";
import { validateConfig } from "./modes.js";
import { imageContent } from "./image.js";
import { prepareWorkspace } from "./workspace.js";
test("FIFO delivery retains messages queued before a consumer waits", async () => {
  const q = new Inbox<string>();
  q.push("first");
  q.push("second");
  assert.equal(q.maxDepth, 2);
  assert.equal(await q.take(), "first");
  assert.equal(await q.take(), "second");
  q.close();
  assert.equal(await q.take(), null);
});
test("a waiting consumer wakes once and close releases an idle consumer", async () => {
  const q = new Inbox<string>();
  const waiting = q.take();
  q.push("actual");
  assert.equal(await waiting, "actual");
  const idle = q.take();
  q.close();
  assert.equal(await idle, null);
  assert.equal(q.size, 0);
});
test("bounded queues reject overflow, concurrent consumers and writes after closure", async () => {
  const q = new Inbox<string>(1);
  q.push("one");
  assert.throws(() => q.push("two"));
  await q.take();
  const waiting = q.take();
  assert.throws(() => q.take());
  q.close();
  await waiting;
  assert.throws(() => q.push("late"));
});
test("a result gate buffers an acknowledgement that arrives before the next await", async () => {
  const gate = new Inbox<boolean>();
  gate.push(true);
  assert.equal(await gate.take(), true);
  gate.close();
  assert.equal(await gate.take(), null);
});
test("control capabilities route to one live run and reject stale or malformed actions", async () => {
  let message = "";
  const r = registerControls(async (c) => {
    message = c.text || c.action;
  });
  try {
    assert.equal(activeCount(), 1);
    assert.equal(
      await applyControl({ id: r.id, action: "send", text: "follow-up" }),
      true,
    );
    assert.equal(message, "follow-up");
    await assert.rejects(applyControl({ id: r.id, action: "send", text: "" }));
    await assert.rejects(applyControl({ id: r.id, action: "unlisted" }));
  } finally {
    r.close();
  }
  assert.equal(await applyControl({ id: r.id, action: "finish" }), false);
  assert.equal(activeCount(), 0);
});
test("only named experiments are accepted", () => {
  assert.deepEqual(validateConfig({ mode: "image" }), { mode: "image" });
  assert.throws(() => validateConfig({ mode: "anything" }));
  assert.throws(() => validateConfig(null));
});
test("image content carries actual PNG bytes and does not reveal the visual marker in text", async () => {
  const content = await imageContent();
  assert.ok(Array.isArray(content));
  if (!Array.isArray(content)) return;
  const image: any = content.find((b) => b.type === "image");
  const text: any = content.find((b) => b.type === "text");
  assert.equal(image.source.media_type, "image/png");
  assert.deepEqual(
    Buffer.from(image.source.data, "base64").subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  assert.ok(!text.text.includes("VISION-35"));
  const bundled = await readFile(
    new URL("../public/message-diagram.png", import.meta.url),
  );
  assert.deepEqual(Buffer.from(image.source.data, "base64"), bundled);
});
test("the disposable fixture is unchanged and private session directories are isolated", async () => {
  const a = await prepareWorkspace(),
    b = await prepareWorkspace();
  try {
    assert.notEqual(a.cwd, b.cwd);
    assert.notEqual(a.sdkHome, b.sdkHome);
    assert.equal((await a.inspect()).fixtureUnchanged, true);
  } finally {
    await a.cleanup();
    await b.cleanup();
  }
});
