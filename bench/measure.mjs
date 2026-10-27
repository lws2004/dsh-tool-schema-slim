/**
 * Measure the projection against a captured tool set.
 *
 * The input is the real tool block of one agent: an array of
 * `{ name, description, parameters }`. Prints per-cap totals and the largest
 * before/after tools so a config change can be judged on evidence.
 *
 * Usage: node bench/measure.mjs <tools.json>
 */
import { readFileSync } from "node:fs";
import { projectDefinition, measureChars } from "../lib/project.js";

const file = process.argv[2];
if (file === undefined) {
  console.error("usage: node bench/measure.mjs <tools.json>");
  process.exit(2);
}
const raw = JSON.parse(readFileSync(file, "utf8"));
const tools = Array.isArray(raw) ? raw : raw.tools;
if (!Array.isArray(tools) || tools.length === 0) {
  console.error("no tools found in input");
  process.exit(2);
}

/** Total characters of the model-facing block. */
const total = (list) => list.reduce((sum, t) => sum + measureChars({ name: t.name, description: t.description, parameters: t.parameters }), 0);

const caps = [
  { label: "120 / 60 / 24", parameterDescriptionChars: 60, nestedDescriptionChars: 24 },
  { label: "160 / 80 / 24", parameterDescriptionChars: 80, nestedDescriptionChars: 24 },
  { label: "160 / 40 / 16", parameterDescriptionChars: 40, nestedDescriptionChars: 16 },
];

const base = total(tools);
console.log(`tools            ${tools.length}`);
console.log(`baseline chars   ${base}  (~${Math.round(base / 4)} tok)`);
console.log("");
console.log("cap            chars    saved    ~tok saved   changed");
for (const cap of caps) {
  const opts = {
    toolDescriptionChars: 160,
    parameterDescriptionChars: cap.parameterDescriptionChars,
    nestedDescriptionChars: cap.nestedDescriptionChars,
    rootDescriptionChars: 0,
  };
  let after = 0;
  let changed = 0;
  for (const tool of tools) {
    const projected = projectDefinition(tool, opts);
    const view = projected ?? tool;
    after += measureChars({ name: view.name, description: view.description, parameters: view.parameters });
    if (projected) changed += 1;
  }
  const saved = base - after;
  console.log(
    `${cap.label.padEnd(14)} ${String(after).padStart(6)}  ${String(saved).padStart(6)}   ${String(Math.round(saved / 4)).padStart(9)}   ${changed}/${tools.length}`,
  );
}

const opts = { toolDescriptionChars: 160, parameterDescriptionChars: 80, nestedDescriptionChars: 24, rootDescriptionChars: 0 };
const rows = tools.map((tool) => {
  const projected = projectDefinition(tool, opts);
  const after = measureChars({ name: tool.name, description: projected?.description, parameters: projected?.parameters });
  const before = measureChars({ name: tool.name, description: tool.description, parameters: tool.parameters });
  return { name: tool.name, before, after: projected ? after : before };
}).filter((r) => r.before !== r.after).sort((a, b) => (b.before - b.after) - (a.before - a.after));
console.log("");
console.log("top savers     " + rows.slice(0, 8).map((r) => `${r.name} ${r.before}->${r.after}`).join(", "));