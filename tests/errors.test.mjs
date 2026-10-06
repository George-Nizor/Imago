import assert from "node:assert/strict";
import { test } from "node:test";
import { eventsDuring, startApp } from "./helpers.mjs";

const done = (e) => e.event === "run.finished" || e.event === "run.error";

// FAKE_CLAUDE_MODE is read by the fake from its environment, so it stays set until t.close().
async function failingTurn(overrides, mode, act) {
  const previous = process.env.FAKE_CLAUDE_MODE;
  if (mode) process.env.FAKE_CLAUDE_MODE = mode;
  const t = await startApp(overrides);
  const close = t.close;
  t.close = async () => {
    if (previous === undefined) delete process.env.FAKE_CLAUDE_MODE;
    else process.env.FAKE_CLAUDE_MODE = previous;
    await close();
  };
  const { body: project } = await t.api("POST", "/api/projects", { preset: "graphic", brief: { description: "poster" } });
  const events = await eventsDuring(t.base, project.id, () => act(t, project.id), done, 30_000);
  const after = (await t.api("GET", `/api/projects/${project.id}`)).body;
  return { t, events, after, id: project.id };
}

const send = (text) => (t, id) => t.api("POST", `/api/projects/${id}/messages`, { text });

test("signed out: capabilities say so and the turn ends with CLAUDE_SIGNED_OUT", async () => {
  const { t, events, after } = await failingTurn({}, "signed-out", send("hi"));
  try {
    const error = events.find((e) => e.event === "run.error");
    assert.equal(error.data.code, "CLAUDE_SIGNED_OUT");
    assert.equal(after.running, false);
    t.app.capabilities.invalidate();
    const caps = (await t.api("GET", "/api/capabilities")).body;
    assert.equal(caps.claude.state, "signed-out");
    assert.match(caps.claude.fix, /claude/);
  } finally {
    await t.close();
  }
});

test("timeout kills the turn and reports TIMEOUT", async () => {
  const { t, events, after } = await failingTurn({ turnTimeoutMs: 1500 }, "slow", send("hi"));
  try {
    assert.equal(events.find((e) => e.event === "run.error").data.code, "TIMEOUT");
    assert.equal(after.running, false);
    // The session id from system/init is kept for the next try.
    assert.equal(after.sessionId, "fake-session-1");
  } finally {
    await t.close();
  }
});

test("cancel kills the turn and reports CANCELLED; a second turn is refused while one runs", async () => {
  const { t, events } = await failingTurn({}, "slow", async (t, id) => {
    assert.equal((await t.api("POST", `/api/projects/${id}/messages`, { text: "go" })).status, 202);
    assert.equal((await t.api("POST", `/api/projects/${id}/messages`, { text: "again" })).status, 409);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal((await t.api("POST", `/api/projects/${id}/cancel`)).status, 200);
  });
  try {
    assert.equal(events.find((e) => e.event === "run.error").data.code, "CANCELLED");
  } finally {
    await t.close();
  }
});

test("a crash without an answer is EXITED, with the stderr tail", async () => {
  const { t, events } = await failingTurn({}, "fail", send("hi"));
  try {
    const error = events.find((e) => e.event === "run.error").data;
    assert.equal(error.code, "EXITED");
    assert.match(error.message, /something exploded/);
  } finally {
    await t.close();
  }
});

test("a missing claude binary is CLAUDE_MISSING and shows in capabilities", async () => {
  const { t, events } = await failingTurn({ claudeBin: "/nonexistent/claude" }, undefined, send("hi"));
  try {
    assert.equal(events.find((e) => e.event === "run.error").data.code, "CLAUDE_MISSING");
    const caps = (await t.api("GET", "/api/capabilities")).body;
    assert.equal(caps.claude.state, "missing");
    assert.ok(caps.claude.fix);
  } finally {
    await t.close();
  }
});

test("a renderer that cannot start is reported as missing with a fix, not a crash", async () => {
  const t = await startApp({ electronBin: "/nonexistent/electron" });
  try {
    const caps = (await t.api("GET", "/api/capabilities")).body;
    assert.equal(caps.renderer.state, "missing");
    assert.ok(caps.renderer.reason && caps.renderer.fix);
  } finally {
    await t.close();
  }
});
