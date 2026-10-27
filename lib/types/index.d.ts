/** Public types for dsh-tool-schema-slim. */

/** Caps and switches, mirroring the Schemastery Config. */
export interface Config {
  /** `terse` projects tool schemas; `off` disables the plugin. */
  mode?: string;
  /** Character cap for each tool description; 0 drops it. */
  toolDescriptionChars?: number;
  /** Character cap for a top-level parameter description. */
  parameterDescriptionChars?: number;
  /** Character cap for descriptions two levels deep or deeper; 0 drops them. */
  nestedDescriptionChars?: number;
  /** Character cap for the argument-root description; 0 drops it. */
  rootDescriptionChars?: number;
  /** Tool names that must keep their full definition. */
  keepTools?: string[];
  /** Skip tools whose parameters are already smaller than this. */
  minChars?: number;
  /** Log the achieved saving once per agent. */
  logSavings?: boolean;
  /** Also log each projected tool, largest saving first. */
  reportTools?: boolean;
  /** Also shorten prose inside each tool output schema. */
  projectOutput?: boolean;
}

/** Resolved caps consumed by the projector. */
export interface ResolvedOptions extends Required<Omit<Config, "keepTools">> {
  /** Tool names exempted from projection. */
  keepFull: Set<string>;
}

/** Minimal shape of the tool definition this plugin reads. */
export interface ToolLike {
  name: string;
  description?: string;
  parameters?: unknown;
  [key: string]: unknown;
}

/** Shorten prose to the leading sentences within `max` characters. */
export function clampText(text: string, max: number): string;

/** Project one JSON Schema node, shortening descriptions by depth. */
export function projectSchema(node: unknown, opts: ResolvedOptions, depth?: number): unknown;

/** Character cost of a schema value in its wire form. */
export function measureChars(node: unknown): number;

/** Project a definition, or return undefined when nothing would change. */
export function projectDefinition(definition: ToolLike, opts: ResolvedOptions): ToolLike | undefined;

/** Resolve the raw config section into resolved caps. */
export function resolveOptions(config: Config): ResolvedOptions;

/** Cordis plugin name used by loader diagnostics. */
export declare const name: string;

/** Services this plugin injects. */
export declare const inject: string[];

/** Schemastery config schema. */
export declare const Config: unknown;

/** Install the in-place projection of visible tool prose. */
export function apply(ctx: unknown, config: Config): void;