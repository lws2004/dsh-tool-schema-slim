/**
 * tool-schema-slim: shrink the per-request tool documentation without
 * changing what any tool does.
 *
 * Every step re-sends the tool block. The registry hands the declared
 * `parameters` to the model, and `schemaOf()` reads `definition.description`
 * on every assembly, so the prose that reaches each provider lives on the
 * live definition objects themselves.
 *
 * This plugin therefore shortens those definitions IN PLACE instead of
 * registering shadow tools. Registering a same-named tool in an agent scope
 * collides with any official plugin that registers that name there (the Team
 * tools register `send_message` through `agent.ctx`), and the collision
 * fails session creation. Editing the definition avoids the registry
 * entirely: no name is taken, no layer is occupied, and every visible tool —
 * global, ancestor, and agent-scoped alike — is covered.
 *
 * Only `description` prose is touched; `execute`, `output`, timeouts, safety
 * flags and every non-prose schema key stay byte-identical. Original prose is
 * restored when the plugin scope is disposed.
 *
 * @module dsh-tool-schema-slim
 */

import Schema from "@deepseek-ai/schemastery";
import { projectDefinition, projectSchema, measureChars } from "./project.js";

/** Greppable prefix on every diagnostic line. */
const TAG = "[tool-schema-slim]";

/**
 * Write one diagnostic line to the process stderr.
 *
 * Deliberately not `ctx.logger`: its default exporter only appends to an
 * in-memory ring buffer, so nothing reaches `dsh-web-stderr.log` and the
 * savings line stays invisible to whoever greps for it.
 * @param line - the diagnostic text, without the prefix.
 */
function report(line) {
  console.error(`${TAG} ${line}`);
}

/**
 * Whether one key of a definition is plain writable data.
 *
 * The PTC transport definition exposes `description` and `parameters` as
 * getters that recompute on every read (and assign throws), so protocol-owned
 * prose like `run_code` must be left alone rather than reported as a failure.
 * @param definition - one visible tool definition.
 * @param key - the property to inspect.
 * @returns true when ordinary assignment is possible.
 */
function isPlainData(definition, key) {
  for (let node = definition; node !== null && node !== undefined; node = Object.getPrototypeOf(node)) {
    const descriptor = Object.getOwnPropertyDescriptor(node, key);
    if (descriptor === undefined) continue;
    return descriptor.get === undefined && descriptor.set === undefined && descriptor.writable === true;
  }
  return true;
}

/**
 * Model-facing size of one definition: its description plus the argument schema.
 * Measuring only `parameters` undercounts the saving, because the tool
 * description itself is trimmed too.
 * @param definition - one tool definition.
 * @returns characters in its wire form.
 */
function measureWhole(definition) {
  return measureChars({
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
  });
}

/** Cordis plugin name used by loader diagnostics. */
export const name = "tool-schema-slim";

/** Registers into the tool registry; no other service is required. */
export const inject = ["tools"];

/** Caps and switches. Defaults are the measured sweet spot. */
export const Config = Schema.object({
  mode: Schema.string().default("terse")
    .description("terse projects tool schemas; off disables the plugin."),
  toolDescriptionChars: Schema.number().step(1).min(0).max(4000).default(160)
    .description("Character cap for each tool description; 0 drops it."),
  parameterDescriptionChars: Schema.number().step(1).min(0).max(2000).default(80)
    .description("Character cap for a top-level parameter description."),
  nestedDescriptionChars: Schema.number().step(1).min(0).max(2000).default(24)
    .description("Character cap for descriptions nested two levels or deeper; 0 drops them."),
  rootDescriptionChars: Schema.number().step(1).min(0).max(2000).default(0)
    .description("Character cap for the argument-root description; 0 drops it."),
  keepTools: Schema.array(Schema.string()).default([])
    .description("Tool names that must keep their full definition."),
  minChars: Schema.number().step(1).min(0).max(200000).default(0)
    .description("Skip tools whose parameters are already smaller than this."),
  logSavings: Schema.boolean().default(true)
    .description("Log the achieved saving once per agent."),
  reportTools: Schema.boolean().default(false)
    .description("Also log each projected tool, largest saving first."),
  projectOutput: Schema.boolean().default(false)
    .description("Also shorten prose inside each tool output schema."),
});

/**
 * Read one config field whether the loader hands out a live accessor or a
 * plain value.
 * @param value - accessor, plain value, or undefined.
 * @param fallback - value to use when the field is absent.
 * @returns the resolved value.
 */
function read(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value.get === "function") {
    const live = value.get();
    return live === undefined || live === null ? fallback : live;
  }
  return value;
}

/**
 * Clamp a numeric config field into a usable range.
 * @param value - candidate number.
 * @param min - inclusive lower bound.
 * @param max - inclusive upper bound.
 * @returns the clamped integer.
 */
function clampInt(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Resolve the raw config into the shape the projector consumes.
 * @param config - the loader-supplied config section.
 * @returns resolved caps.
 */
export function resolveOptions(config) {
  const keep = read(config.keepTools, []) ?? [];
  return {
    mode: String(read(config.mode, "terse")),
    toolDescriptionChars: clampInt(read(config.toolDescriptionChars, 160), 0, 4000),
    parameterDescriptionChars: clampInt(read(config.parameterDescriptionChars, 80), 0, 2000),
    nestedDescriptionChars: clampInt(read(config.nestedDescriptionChars, 24), 0, 2000),
    rootDescriptionChars: clampInt(read(config.rootDescriptionChars, 0), 0, 2000),
    keepFull: new Set(keep),
    minChars: clampInt(read(config.minChars, 0), 0, 200000),
    logSavings: read(config.logSavings, true) === true,
    reportTools: read(config.reportTools, false) === true,
    projectOutput: read(config.projectOutput, false) === true,
  };
}

/**
 * Copy projected prose back onto a live schema node, leaving every other key
 * untouched. Mirrors the structure walk in `projectSchema`.
 * @param target - the live schema node to edit in place.
 * @param source - the projected node that carries the shortened prose.
 */
function applySchemaProse(target, source) {
  if (target === null || typeof target !== "object" || Array.isArray(target)) return;
  const projected = source !== null && typeof source === "object" ? source : undefined;
  if (typeof projected?.description === "string" && projected.description.length > 0) {
    target.description = projected.description;
  } else if (Object.prototype.hasOwnProperty.call(target, "description")) {
    delete target.description;
  }
  if (target.properties && typeof target.properties === "object" && projected?.properties && typeof projected.properties === "object") {
    for (const key of Object.keys(projected.properties)) {
      if (target.properties[key]) applySchemaProse(target.properties[key], projected.properties[key]);
    }
  }
  for (const key of ["items", "additionalProperties", "oneOf", "anyOf", "allOf", "prefixItems"]) {
    const live = target[key];
    const projectedChild = projected?.[key];
    if (Array.isArray(live) && Array.isArray(projectedChild)) {
      for (let i = 0; i < live.length; i += 1) applySchemaProse(live[i], projectedChild[i]);
    } else if (live !== null && typeof live === "object" && projectedChild !== null && typeof projectedChild === "object") {
      applySchemaProse(live, projectedChild);
    }
  }
}

/**
 * Shrink the prose of every tool visible to one agent, in place.
 * @param ctx - the plugin context.
 * @param config - the raw config section.
 */
export function apply(ctx, config) {
  /** Per-agent summary for the log line. */
  const reported = new WeakSet();
  /** Original prose, keyed by the definition object, for disposal restore. */
  const originals = new Map();

  /**
   * Shorten one agent's visible definitions.
   * @param agent - the created agent (the registry viewing scope).
   */
  const shrinkAgent = (agent) => {
    const options = resolveOptions(config);
    if (options.mode !== "terse") return;
    let visible;
    try {
      visible = [...(ctx.tools.view(agent)?.visible?.values() ?? [])];
    } catch (error) {
      report(`view() failed, leaving tools intact: ${String(error)}`);
      return;
    }
    let before = 0;
    let after = 0;
    let shrunk = 0;
    const rows = [];
    for (const definition of visible) {
      const toolName = definition?.name;
      if (typeof toolName !== "string" || options.keepFull.has(toolName)) continue;
      if (!isPlainData(definition, "description") || !isPlainData(definition, "parameters")) continue;
      const size = measureChars(definition.parameters);
      if (options.minChars > 0 && size < options.minChars) continue;
      let projected;
      try {
        projected = projectDefinition(definition, options);
      } catch (error) {
        report(`project(${toolName}) failed: ${String(error)}`);
        continue;
      }
      // A second pass returns undefined, which is what keeps this convergent
      // across agents that share the same global definition.
      if (!projected) continue;
      const was = measureWhole(definition);
      const outputSchema = options.projectOutput ? definition?.output?.schema : undefined;
      try {
        if (!originals.has(definition)) {
          originals.set(definition, {
            description: definition.description,
            parameters: structuredClone(definition.parameters),
            output: outputSchema === undefined ? undefined : structuredClone(outputSchema),
          });
        }
        definition.description = projected.description;
        applySchemaProse(definition.parameters, projected.parameters);
        if (outputSchema !== undefined) applySchemaProse(outputSchema, projectSchema(outputSchema, options, 0));
      } catch (error) {
        report(`shrink(${toolName}) failed: ${String(error)}`);
        continue;
      }
      const now = measureWhole(definition);
      shrunk += 1;
      before += was;
      after += now;
      if (was !== now) rows.push({ name: toolName, before: was, after: now });
    }
    if (options.logSavings && shrunk > 0 && !reported.has(agent)) {
      reported.add(agent);
      const percent = before === 0 ? 0 : Math.round((1 - after / before) * 100);
      report(`${shrunk} tools projected, tool block ${before} -> ${after} chars (-${percent}%)`);
      if (options.reportTools) {
        let outputChars = 0;
        let outputSlim = 0;
        for (const definition of visible) {
          const schema = definition?.output?.schema;
          const size = measureChars(schema);
          outputChars += size;
          try {
            outputSlim += measureChars(projectSchema(schema, options, 0));
          } catch {
            outputSlim += size;
          }
        }
        report(`  output schemas: ${outputChars} chars (${outputSlim} if their prose were projected)`);
        rows.sort((a, b) => b.before - b.after - (a.before - a.after));
        for (const row of rows) {
          const rowPercent = row.before === 0 ? 0 : Math.round((1 - row.after / row.before) * 100);
          report(`  ${row.name}: ${row.before} -> ${row.after} (-${rowPercent}%)`);
        }
      }
    }
  };

  ctx.on("agent/created", ({ agent }) => {
    // Defer one task: official plugins register their scoped tools in this
    // same dispatch, and the registry view must already contain them so they
    // are covered too. Nothing here takes a registry name, so this delay is
    // about breadth, not about avoiding a collision.
    setTimeout(() => {
      try {
        shrinkAgent(agent);
      } catch (error) {
        report(`agent/created handler failed: ${String(error)}`);
      }
    }, 0);
  });

  ctx.effect(() => () => {
    for (const [definition, original] of originals) {
      try {
        definition.description = original.description;
        definition.parameters = original.parameters;
        if (original.output !== undefined && definition.output !== undefined) definition.output.schema = original.output;
      } catch {
        /* frozen definition: nothing to restore */
      }
    }
    originals.clear();
  }, "tool-schema-slim:restore");
}
