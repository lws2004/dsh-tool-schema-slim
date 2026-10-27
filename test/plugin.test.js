/** Wiring checks against a stub host: in-place projection of tool prose. */
import test from "node:test";
import assert from "node:assert/strict";
import { apply, Config, resolveOptions } from "../lib/index.js";

const LONG_TOOL = "读取当前设备统一能力清单并返回可用能力、取样时间与失败原因。只读，不执行任何操作。ready 只表示公共前置条件已经满足，具体目标是否可用仍以操作工具的回执为准。调用前不需要额外参数，调用后请根据返回的 alternatives 决定下一步。这一整段额外叮嘱和示例都不影响填参，只是读起来完整。还有更长的历史沿革与常见误用举例。";

/**
 * Run `body` with process stderr captured, so diagnostics can be asserted
 * without polluting the test output.
 * @param body - receives the captured lines array.
 */
async function captureStderr(body) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.join(" "));
  try {
    await body(lines);
  } finally {
    console.error = original;
  }
  return lines;
}

/** Build a stub host with one registered tool and one agent scope. */
function makeHost() {
  const execute = async (args) => ({ text: `ran ${args.code}` });
  const output = { schema: { type: "object" }, render: () => [] };
  const definition = {
    name: "run_code",
    description: LONG_TOOL,
    parameters: {
      type: "object",
      required: ["code"],
      properties: { code: { type: "string", description: LONG_TOOL } },
    },
    execute,
    output,
  };
  const global = new Map([["run_code", definition]]);
  const scoped = new Map();
  const agent = { id: "agent-1", ctx: undefined };
  const handlers = {};
  const disposers = [];
  const scope = {
    tools: {
      register() {
        throw new Error("register must never be called: this plugin edits definitions in place");
      },
    },
    effect(fn) {
      return fn();
    },
  };
  agent.ctx = scope;
  const ctx = {
    tools: {
      view(view) {
        const visible = new Map(global);
        if (view === agent) for (const [key, value] of scoped) visible.set(key, value);
        return { visible };
      },
      get(name, view) {
        if (view === agent && scoped.has(name)) return scoped.get(name);
        return global.get(name);
      },
    },
    on(event, callback) {
      handlers[event] = callback;
      return () => {};
    },
    effect(fn) {
      const dispose = fn();
      disposers.push(dispose);
      return () => {};
    },
  };
  return { ctx, agent, scope, global, scoped, definition, handlers, execute, output, disposers };
}

test("Config exposes the documented defaults", () => {
  const resolved = resolveOptions({});
  assert.equal(resolved.mode, "terse");
  assert.equal(resolved.toolDescriptionChars, 160);
  assert.equal(resolved.parameterDescriptionChars, 80);
  assert.equal(resolved.nestedDescriptionChars, 24);
  assert.equal(resolved.rootDescriptionChars, 0);
  assert.ok(Config);
});

test("agent/created shortens the visible definition in place", async () => {
  const host = makeHost();
  apply(host.ctx, {});
  assert.equal(typeof host.handlers["agent/created"], "function");
  host.handlers["agent/created"]({ agent: host.agent });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const definition = host.definition;
  assert.ok(definition.description.length <= 160, `tool description still ${definition.description.length}`);
  assert.ok(definition.description.length < LONG_TOOL.length);
  assert.ok(definition.parameters.properties.code.description.length <= 80);
  assert.equal(definition.execute, host.execute, "execute must stay byte-identical");
  assert.equal(definition.output, host.output, "output must stay byte-identical");
  assert.deepEqual(definition.parameters.required, ["code"]);
  assert.equal(host.scoped.size, 0, "the plugin must not take any tool name");
});

test("off leaves every tool untouched", async () => {
  const host = makeHost();
  apply(host.ctx, { mode: "off" });
  host.handlers["agent/created"]({ agent: host.agent });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(host.definition.description, LONG_TOOL);
});

test("keepTools exempts a tool from projection", async () => {
  const host = makeHost();
  apply(host.ctx, { keepTools: ["run_code"] });
  host.handlers["agent/created"]({ agent: host.agent });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(host.definition.description, LONG_TOOL);
});

test("a throwing view() does not fail the handler", async () => {
  const host = makeHost();
  host.ctx.tools.view = () => {
    throw new Error("boom");
  };
  apply(host.ctx, {});
  const lines = await captureStderr(async () => {
    assert.doesNotThrow(() => host.handlers["agent/created"]({ agent: host.agent }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.ok(lines.some((line) => line.includes("view() failed")));
  assert.equal(host.definition.description, LONG_TOOL);
});

test("disposal restores the original prose", async () => {
  const host = makeHost();
  apply(host.ctx, {});
  host.handlers["agent/created"]({ agent: host.agent });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(host.definition.description.length < LONG_TOOL.length);
  for (const dispose of host.disposers) if (typeof dispose === "function") dispose();
  assert.equal(host.definition.description, LONG_TOOL);
  assert.equal(host.definition.parameters.properties.code.description, LONG_TOOL);
});

/**
 * Build a host that mirrors the real registry: the viewing scope is the AGENT
 * itself, and agent-plane tools resolve only when the agent is the view.
 */
function makeAgentPlaneHost() {
  const output = { schema: { type: "object" }, render: () => [] };
  const globalTool = {
    name: "web_search",
    description: LONG_TOOL,
    parameters: { type: "object", properties: { query: { type: "string", description: LONG_TOOL } } },
    execute: async () => ({}),
    output,
  };
  const agentTool = {
    name: "bash",
    description: LONG_TOOL,
    parameters: { type: "object", properties: { command: { type: "string", description: LONG_TOOL } } },
    execute: async () => ({}),
    output,
  };
  const global = new Map([["web_search", globalTool]]);
  const agentLayer = new Map([["bash", agentTool]]);
  const handlers = {};
  const agent = { id: "agent-1", ctx: undefined };
  const scope = {
    tools: {
      register() {
        throw new Error("register must never be called");
      },
    },
    effect(fn) {
      return fn();
    },
  };
  agent.ctx = scope;
  const ctx = {
    tools: {
      view(view) {
        const visible = new Map(global);
        if (view === agent) for (const [key, value] of agentLayer) visible.set(key, value);
        return { visible };
      },
      get(name, view) {
        if (view === agent && agentLayer.has(name)) return agentLayer.get(name);
        return global.get(name);
      },
    },
    on(event, callback) {
      handlers[event] = callback;
      return () => {};
    },
    effect(fn) {
      return () => {};
    },
  };
  return { ctx, agent, agentLayer, global, handlers, globalTool, agentTool };
}

test("agent-plane tools are projected too, without registering anything", async () => {
  const host = makeAgentPlaneHost();
  apply(host.ctx, {});
  const lines = await captureStderr(async () => {
    host.handlers["agent/created"]({ agent: host.agent });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.ok(host.agentTool.description.length <= 160, "agent-plane tool description was not shortened");
  assert.ok(host.globalTool.description.length <= 160, "global tool description was not shortened");
  assert.equal(host.agentLayer.get("bash"), host.agentTool, "the agent-layer definition must keep its own identity");
  assert.ok(lines.some((line) => line.includes("2 tools projected")), "savings line should count both layers");
});

test("a getter-only definition is skipped without a failure line", async () => {
  const host = makeHost();
  const transport = {
    name: "ptc_transport",
    execute: async () => ({}),
    output: { schema: { type: "object" }, render: () => [] },
  };
  Object.defineProperty(transport, "description", { enumerable: true, get: () => LONG_TOOL });
  Object.defineProperty(transport, "parameters", {
    enumerable: true,
    get: () => ({ type: "object", properties: { code: { type: "string", description: LONG_TOOL } } }),
  });
  host.global.set("ptc_transport", transport);
  apply(host.ctx, {});
  const lines = await captureStderr(async () => {
    host.handlers["agent/created"]({ agent: host.agent });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.equal(transport.description, LONG_TOOL, "protocol prose must stay untouched");
  assert.equal(transport.parameters.properties.code.description, LONG_TOOL);
  assert.ok(!lines.some((line) => line.includes("failed")), "a read-only definition must not report a failure");
  assert.ok(lines.some((line) => line.includes("tools projected")), "the writable tool is still projected");
});

test("reportTools adds one line per projected tool", async () => {
  const host = makeHost();
  apply(host.ctx, { reportTools: true });
  const lines = await captureStderr(async () => {
    host.handlers["agent/created"]({ agent: host.agent });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.ok(lines.some((line) => line.includes("tool block")), "the summary must cover the whole tool block");
  assert.ok(lines.some((line) => line.includes("run_code:")), "each projected tool gets its own line");
});

test("reportTools stays silent by default", async () => {
  const host = makeHost();
  apply(host.ctx, {});
  const lines = await captureStderr(async () => {
    host.handlers["agent/created"]({ agent: host.agent });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.ok(!lines.some((line) => line.includes("run_code:")), "detail lines are opt-in");
});

test("projectOutput shortens output prose and restores it on dispose", async () => {
  const host = makeHost();
  const outputSchema = {
    type: "object",
    properties: { value: { type: "string", description: LONG_TOOL } },
  };
  host.definition.output = { schema: outputSchema, render: () => [] };
  apply(host.ctx, { projectOutput: true });
  host.handlers["agent/created"]({ agent: host.agent });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(host.definition.output.schema.properties.value.description.length <= 80);
  for (const dispose of host.disposers) if (typeof dispose === "function") dispose();
  assert.equal(host.definition.output.schema.properties.value.description, LONG_TOOL);
});

test("projectOutput off leaves the output schema untouched", async () => {
  const host = makeHost();
  const outputSchema = {
    type: "object",
    properties: { value: { type: "string", description: LONG_TOOL } },
  };
  host.definition.output = { schema: outputSchema, render: () => [] };
  apply(host.ctx, {});
  host.handlers["agent/created"]({ agent: host.agent });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(host.definition.output.schema.properties.value.description, LONG_TOOL);
});
