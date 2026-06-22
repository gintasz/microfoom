import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { parseDecoratorsForFunction, type ParsedDecorator } from "thoughtcode-core";

/** Deterministic run configuration assembled from a VIBEFUNCTION's decorators. */
export interface VibeRunConfig {
  /** Override the model used to execute this VIBEFUNCTION (matched by id or `provider/id`). */
  modelId?: string;
  /** Reasoning level for the subagent. */
  thinkingLevel?: "off" | "low" | "medium" | "high";
  /** Abort + throw if the VIBEFUNCTION runs longer than this. */
  timeoutMs?: number;
  /** Abort + throw if the VIBEFUNCTION's own token cost exceeds this many USD. */
  budgetUsd?: number;
}

const THINKING_LEVELS = ["off", "low", "medium", "high"] as const;

interface DecoratorSpec {
  /** Validate the parsed decorator and apply it to the config. Returns an error string on failure. */
  apply(config: VibeRunConfig, decorator: ParsedDecorator): string | undefined;
}

function singlePositional(decorator: ParsedDecorator): { value: unknown } | { error: string } {
  if (Object.keys(decorator.kwargs).length > 0) {
    return { error: `@${decorator.name} takes a single positional argument, not keyword arguments` };
  }
  if (decorator.positional === undefined) {
    return { error: `@${decorator.name} requires an argument` };
  }
  return { value: decorator.positional };
}

/** Registry of known decorators. Add a behavior here = one entry; no prompt rules involved. */
export const DECORATOR_REGISTRY: Record<string, DecoratorSpec> = {
  model: {
    apply(config, decorator) {
      const arg = singlePositional(decorator);
      if ("error" in arg) return arg.error;
      if (typeof arg.value !== "string") return "@model expects a string model id";
      config.modelId = arg.value;
      return undefined;
    },
  },
  thinking: {
    apply(config, decorator) {
      const arg = singlePositional(decorator);
      if ("error" in arg) return arg.error;
      if (typeof arg.value !== "string" || !(THINKING_LEVELS as readonly string[]).includes(arg.value)) {
        return `@thinking expects one of: ${THINKING_LEVELS.join(", ")}`;
      }
      config.thinkingLevel = arg.value as VibeRunConfig["thinkingLevel"];
      return undefined;
    },
  },
  timeout: {
    apply(config, decorator) {
      const arg = singlePositional(decorator);
      if ("error" in arg) return arg.error;
      if (typeof arg.value !== "number" || !Number.isFinite(arg.value) || arg.value <= 0) {
        return "@timeout expects a positive number of seconds";
      }
      config.timeoutMs = Math.round(arg.value * 1000);
      return undefined;
    },
  },
  budget: {
    apply(config, decorator) {
      const arg = singlePositional(decorator);
      if ("error" in arg) return arg.error;
      if (typeof arg.value !== "number" || !Number.isFinite(arg.value) || arg.value <= 0) {
        return "@budget expects a positive number (USD)";
      }
      config.budgetUsd = arg.value;
      return undefined;
    },
  },
};

/** Turn parsed decorators into a run config, collecting validation errors (unknown name, bad args). */
export function buildVibeRunConfig(decorators: ParsedDecorator[]): { config: VibeRunConfig; errors: string[] } {
  const config: VibeRunConfig = {};
  const errors: string[] = [];
  for (const decorator of decorators) {
    const spec = DECORATOR_REGISTRY[decorator.name];
    if (!spec) {
      errors.push(`Unknown decorator @${decorator.name}. Known: ${Object.keys(DECORATOR_REGISTRY).join(", ")}.`);
      continue;
    }
    const error = spec.apply(config, decorator);
    if (error) errors.push(error);
  }
  return { config, errors };
}

export type ResolvedDecorators =
  | { status: "ok"; config: VibeRunConfig }
  | { status: "invalid"; errors: string[] }
  | { status: "unreadable" };

/** Read the program file and resolve a VIBEFUNCTION's decorators into a validated run config. */
export async function resolveDecorators(
  programFilePath: string,
  functionName: string,
  cwd: string | undefined,
): Promise<ResolvedDecorators> {
  let text: string;
  try {
    const absolute = isAbsolute(programFilePath) ? programFilePath : resolve(cwd ?? process.cwd(), programFilePath);
    text = await readFile(absolute, "utf8");
  } catch {
    return { status: "unreadable" };
  }
  const parsed = parseDecoratorsForFunction(text, functionName);
  if (parsed.errors.length > 0) {
    return { status: "invalid", errors: parsed.errors };
  }
  const built = buildVibeRunConfig(parsed.decorators);
  if (built.errors.length > 0) {
    return { status: "invalid", errors: built.errors };
  }
  return { status: "ok", config: built.config };
}
