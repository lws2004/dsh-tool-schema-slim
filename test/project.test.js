/** Structural checks for the projection, no host required. */
import test from "node:test";
import assert from "node:assert/strict";
import { clampText, projectSchema, projectDefinition, measureChars } from "../lib/project.js";

const opts = {
  toolDescriptionChars: 160,
  parameterDescriptionChars: 80,
  nestedDescriptionChars: 24,
  rootDescriptionChars: 0,
};

/** A parameter description comfortably above the 80-char cap. */
const LONG_PARAM = "调度模式，决定其余字段哪些必需，必须与 time 字段配合使用才有效。可选 daily、weekly、every 三种，其中 weekly 需要同时给出 weekdays 数组，every 需要 every_seconds 正整数。";

/** A nested description above the 24-char cap. */
const LONG_NESTED = "精确的工具名，大小写敏感，不支持通配符匹配，也不支持省略前缀的简写形式。";

/** A tool description above the 160-char cap. */
const LONG_TOOL = "读取当前设备统一能力清单并返回可用能力、取样时间与失败原因。只读，不执行任何操作。ready 只表示公共前置条件已经满足，具体目标是否可用仍以操作工具的回执为准。调用前不需要额外参数，调用后请根据返回的 alternatives 决定下一步，不要重复调用同一工具。这一整段额外叮嘱和示例都不影响填参，只是读起来完整。此外还有更长的历史沿革说明、与其它工具的对比、常见误用的举例，以及维护者留下的一段背景叙述。";

test("clampText keeps short text untouched", () => {
  assert.equal(clampText("短说明", 80), "短说明");
});

test("clampText is idempotent", () => {
  const once = clampText(LONG_PARAM, 80);
  const twice = clampText(once, 80);
  assert.equal(twice, once);
  assert.ok(once.length <= 81, `clamped length ${once.length}`);
});

test("clampText drops everything at cap 0", () => {
  assert.equal(clampText("anything here", 0), "");
});

test("clampText marks a sentence-boundary cut with an ellipsis", () => {
  const once = clampText(LONG_PARAM, 80);
  assert.ok(once.endsWith("…"), "a shortened description must show it was cut");
  assert.ok(once.length <= 80, `clamped length ${once.length} exceeds the cap`);
  assert.equal(clampText(once, 80), once, "the ellipsis form must stay idempotent");
});

test("projectSchema preserves every non-description key", () => {
  const schema = {
    type: "object",
    required: ["mode", "names"],
    additionalProperties: false,
    properties: {
      mode: { type: "string", enum: ["daily", "weekly"], description: LONG_PARAM },
      names: { type: "array", items: { type: "string", description: LONG_NESTED } },
    },
  };
  const out = projectSchema(schema, opts, 0);
  assert.equal(out.type, "object");
  assert.deepEqual(out.required, schema.required);
  assert.equal(out.additionalProperties, false);
  assert.deepEqual(out.properties.mode.enum, schema.properties.mode.enum);
  assert.ok(out.properties.mode.description.length <= 81);
  assert.equal(out.properties.names.items.type, "string");
  assert.ok(out.properties.names.items.description.length <= 25);
  assert.ok(measureChars(out) < measureChars(schema));
});

test("projectSchema keeps structure identical for a tool with no prose", () => {
  const schema = { type: "object", properties: { a: { type: "number" } }, required: ["a"] };
  const out = projectSchema(schema, opts, 0);
  assert.equal(JSON.stringify(out), JSON.stringify(schema));
});

test("projectDefinition returns undefined when nothing changes", () => {
  const definition = {
    name: "tiny",
    description: "short",
    parameters: { type: "object", properties: { a: { type: "string" } } },
    execute: async () => ({}),
  };
  assert.equal(projectDefinition(definition, opts), undefined);
});

test("projectDefinition keeps execute and output, shortens prose", () => {
  const execute = async () => ({});
  const output = { schema: { type: "object" }, render: () => [] };
  const definition = {
    name: "big",
    description: LONG_TOOL,
    parameters: {
      type: "object",
      required: ["code"],
      properties: {
        code: { type: "string", description: LONG_PARAM },
      },
    },
    execute,
    output,
  };
  const projected = projectDefinition(definition, opts);
  assert.ok(projected);
  assert.equal(projected.execute, execute);
  assert.equal(projected.output, output);
  assert.deepEqual(projected.parameters.required, ["code"]);
  assert.ok(projected.description.length <= 161);
  assert.ok(projected.parameters.properties.code.description.length <= 81);
  assert.ok(measureChars(projected.parameters) < measureChars(definition.parameters));
});

test("projectDefinition converges on a second pass", () => {
  const definition = {
    name: "big",
    description: LONG_TOOL,
    parameters: { type: "object", properties: { a: { type: "string", description: LONG_NESTED } } },
  };
  const once = projectDefinition(definition, opts);
  assert.ok(once);
  assert.equal(projectDefinition(once, opts), undefined);
});