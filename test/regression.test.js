import test from "node:test";
import assert from "node:assert/strict";
import { apply } from "../lib/index.js";

const LONG = "这是一段很长的工具说明。它解释这个工具做什么，以及很多额外叮嘱和使用示例。这些内容对填参没有直接帮助。" + "还有更长的历史沿革与常见误用举例，用来确保超过一百六十字符的上限。".repeat(6);

/** A tool whose parameters are all short but whose tool-level description is long. */
function makeHostWithShortParams() {
  const definition = {
    name: "bash",
    description: LONG,
    parameters: { type: "object", required: ["command"], properties: { command: { type: "string", description: "The command." } } },
    execute: async () => ({}),
    output: { schema: { type: "object" }, render: () => [] },
  };
  const global = new Map([["bash", definition]]);
  const agent = { id: "agent-1", ctx: undefined };
  const handlers = {};
  const scope = { tools: { register() { throw new Error("must not register"); } }, effect(fn) { return fn(); } };
  agent.ctx = scope;
  const ctx = {
    tools: {
      view(view) { return { visible: new Map(global) }; },
      get(n) { return global.get(n); },
    },
    on(e, cb) { handlers[e] = cb; return () => {}; },
    effect(fn) { return () => {}; },
  };
  return { ctx, agent, definition, handlers };
}

test("a long tool description is projected even when every parameter is short", async () => {
  const host = makeHostWithShortParams();
  apply(host.ctx, {});
  host.handlers["agent/created"]({ agent: host.agent });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(host.definition.description.length <= 160, `description still ${host.definition.description.length}`);
  assert.ok(host.definition.description.length < LONG.length);
});

test("an official scoped tool keeps its name and is never touched by the plugin", async () => {
  const official = { name: "send_message", description: "official", parameters: { type: "object", properties: {} } };
  const globalDef = { name: "send_message", description: LONG, parameters: { type: "object", properties: {} } };
  const global = new Map([["send_message", globalDef]]);
  const scoped = new Map([["send_message", official]]);
  const agent = { id: "agent-1", ctx: undefined };
  const handlers = {};
  const scope = {
    tools: {
      register(n) {
        if (scoped.has(n.name)) throw new Error(`tool "${n.name}" is already registered in this scope`);
        scoped.set(n.name, n);
        return () => scoped.delete(n.name);
      },
    },
    effect(fn) { return fn(); },
  };
  agent.ctx = scope;
  const ctx = {
    tools: {
      view(view) {
        const visible = new Map(global);
        if (view === agent) for (const [k, v] of scoped) visible.set(k, v);
        return { visible };
      },
      get(n, view) { return (view === agent ? scoped.get(n) : undefined) ?? global.get(n); },
    },
    on(e, cb) { handlers[e] = cb; return () => {}; },
    effect(fn) { return () => {}; },
  };
  apply(ctx, {});
  assert.doesNotThrow(() => handlers["agent/created"]({ agent }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(scoped.get("send_message"), official, "the official scoped tool must keep its name and object");
  assert.equal(official.description, "official", "the official scoped definition must not be rewritten");
});
