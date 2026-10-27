/**
 * Structural projection for tool-schema-slim.
 *
 * Pure functions only: the same definition always yields the same projection,
 * so the model-facing tool block stays byte-stable between steps and never
 * invalidates the upstream prompt cache on its own.
 *
 * Every key except `description` is copied verbatim. Only prose shrinks, and
 * never below a configurable cap, so nothing that changes how a model fills
 * arguments is dropped.
 *
 * @module dsh-tool-schema-slim/project
 */

/** Collapse whitespace runs to one space. */
export function squeeze(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

/** Sentence terminators, including CJK forms. */
const TERMINATORS = ["。", "！", "？", "；", ";", "!", "?"];

/** Clause boundary markers used when no sentence boundary fits. */
const CLAUSES = ["，", "、", "；", ", ", "; ", " "];

/**
 * Keep the leading part of a description within `max` characters.
 * Cuts on a sentence boundary when one fits, else on a clause boundary, and
 * appends an ellipsis so the model can tell text was shortened.
 * Idempotent: clamping an already-clamped string returns it unchanged.
 * @param text - raw description.
 * @param max - character cap; 0 or less drops the description.
 * @returns the shortened description.
 */
export function clampText(text, max) {
  const t = squeeze(text);
  if (max <= 0) return "";
  if (t.length <= max) return t;
  let cut = -1;
  let from = 0;
  for (;;) {
    let best = -1;
    for (const mark of TERMINATORS) {
      const at = t.indexOf(mark, from);
      if (at >= 0 && (best < 0 || at < best)) best = at;
    }
    if (best < 0) break;
    const end = best + 1;
    if (end > max) break;
    cut = end;
    from = end;
  }
  if (cut > max * 0.4) {
    const head = t.slice(0, cut).trim();
    const room = max - head.length;
    if (room >= 1) return head + "…";
    const trimmed = head.slice(0, Math.max(0, max - 1)).trim();
    return trimmed.length > 0 ? trimmed + "…" : "…";
  }
  const window = t.slice(0, Math.max(0, max - 1));
  let at2 = -1;
  for (const mark of CLAUSES) {
    const found = window.lastIndexOf(mark);
    if (found > at2) at2 = found;
  }
  const body = (at2 > max * 0.5 ? window.slice(0, at2) : window).trim();
  return body.length > 0 ? body + "…" : "…";
}

/**
 * Project one JSON Schema node, shortening descriptions by depth.
 * @param node - schema node.
 * @param opts - resolved caps.
 * @param depth - 0 at the argument root, 1 for a top-level parameter.
 * @returns a new node with shortened prose and identical structure.
 */
export function projectSchema(node, opts, depth = 0) {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((entry) => projectSchema(entry, opts, depth));
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "description") continue;
    if (key === "properties") {
      const properties = {};
      for (const [name, sub] of Object.entries(value ?? {})) {
        properties[name] = projectSchema(sub, opts, depth + 1);
      }
      out.properties = properties;
      continue;
    }
    if (key === "items" || key === "additionalProperties") {
      out[key] = value !== null && typeof value === "object" ? projectSchema(value, opts, depth + 1) : value;
      continue;
    }
    if (key === "oneOf" || key === "anyOf" || key === "allOf") {
      out[key] = (Array.isArray(value) ? value : []).map((sub) => projectSchema(sub, opts, depth + 1));
      continue;
    }
    out[key] = value;
  }
  if (typeof node.description === "string" && node.description.length > 0) {
    const cap = depth <= 0
      ? opts.rootDescriptionChars
      : depth === 1
        ? opts.parameterDescriptionChars
        : opts.nestedDescriptionChars;
    const text = cap > 0 ? clampText(node.description, cap) : "";
    if (text.length > 0) out.description = text;
  }
  return out;
}

/** Character cost of a schema value in its wire form. */
export function measureChars(node) {
  try {
    return JSON.stringify(node ?? null).length;
  } catch {
    return 0;
  }
}

/**
 * Project a whole tool definition.
 * Returns undefined when nothing would change, which is what makes repeated
 * passes converge instead of re-registering forever.
 * @param definition - the registered tool definition.
 * @param opts - resolved caps.
 * @returns a projected definition, or undefined for no change.
 */
export function projectDefinition(definition, opts) {
  const parameters = definition?.parameters;
  if (parameters === null || typeof parameters !== "object" || Array.isArray(parameters)) return undefined;
  const before = typeof definition.description === "string" ? definition.description : "";
  const after = opts.toolDescriptionChars > 0 ? clampText(before, opts.toolDescriptionChars) : "";
  const projected = projectSchema(parameters, opts, 0);
  const changed = measureChars(parameters) !== measureChars(projected) || before !== after;
  if (!changed) return undefined;
  return { ...definition, description: after, parameters: projected };
}