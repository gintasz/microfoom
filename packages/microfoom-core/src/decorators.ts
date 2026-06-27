// The public decorator surface: `@foom.config` and `@foom.expose`. Decorators run
// at class-definition time (no instance) and only record metadata (registry.ts);
// they never run prompts. Methods are unreachable by default — only @foom.expose
// makes one agent-callable (F3), and a language-private (#) member can never be
// exposed.

import { FoomtimeConfigError } from "./errors.js";
import type { AgentExposeOptions, AgentOptions, AgentToolOptions } from "./options.js";
import { classMetaForCtor, type ExposeMeta, type ExposureTier, methodMetaFor } from "./registry.js";

/** A decorator usable on a class. */
export type AgentClassDecorator = <T extends abstract new (...args: never[]) => object>(
  value: T,
  context: ClassDecoratorContext<T>,
) => T | undefined;

/** A decorator usable on a method. */
export type AgentMethodDecorator = <This, Args extends readonly unknown[], Return>(
  value: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
) => ((this: This, ...args: Args) => Return) | undefined;

/** Usable on either a class or a method. */
export type AgentDecorator = AgentClassDecorator & AgentMethodDecorator;

/** `@foom.config(options)` — class/method config decorator. */
export type AgentConfigDecorator = (options: AgentOptions) => AgentDecorator;

/** `@foom.expose` (bare) or `@foom.expose(options)`. */
export type AgentExposeDecorator = AgentMethodDecorator &
  ((options?: AgentExposeOptions) => AgentMethodDecorator);

/** The module-level decorator namespace. */
export interface AgentDecorators {
  readonly config: AgentConfigDecorator;
  readonly expose: AgentExposeDecorator;
}

type AnyDecoratorContext = DecoratorContext;
type MethodContext = ClassMethodDecoratorContext;

function isDecoratorContext(value: unknown): value is AnyDecoratorContext {
  return typeof value === "object" && value !== null && "kind" in value;
}

function makeConfig(options: AgentOptions): AgentDecorator {
  const decorate = (_value: unknown, context: AnyDecoratorContext): void => {
    if (context.kind === "class") {
      context.addInitializer(function (this: unknown) {
        classMetaForCtor(this as object).config = options;
      });
      return;
    }
    if (context.kind === "method") {
      const name = String(context.name);
      context.addInitializer(function (this: unknown) {
        methodMetaFor(classMetaForCtor(ctorOf(this)), name).config = options;
      });
      return;
    }
    throw new FoomtimeConfigError("@foom.config applies to a class or method only.");
  };
  // The runtime handles both class and method contexts; the public type is the
  // intersection, which no single concrete function signature can express.
  return decorate as unknown as AgentDecorator;
}

function buildExposeMeta(
  name: string,
  tier: ExposureTier,
  options: AgentExposeOptions | undefined,
): ExposeMeta {
  const meta: {
    dispatchName: string;
    tier: ExposureTier;
    announcement?: string;
    tool?: AgentToolOptions;
  } = {
    dispatchName: name,
    tier,
  };
  if (options?.announcement !== undefined) meta.announcement = options.announcement;
  if (options?.tool !== undefined) meta.tool = options.tool;
  return meta;
}

function applyExpose(options: AgentExposeOptions | undefined, context: MethodContext): void {
  if (context.kind !== "method") {
    throw new FoomtimeConfigError("@foom.expose applies to methods only.");
  }
  if (context.private) {
    throw new FoomtimeConfigError("Private (#) members can never be exposed to the agent (F3).");
  }
  const tier: ExposureTier =
    options?.tool !== undefined
      ? "tool"
      : options?.announcement !== undefined
        ? "announcement"
        : "silent";
  const name = String(context.name);
  const meta = buildExposeMeta(name, tier, options);
  context.addInitializer(function (this: unknown) {
    methodMetaFor(classMetaForCtor(ctorOf(this)), name).expose = meta;
  });
}

/** The constructor of an instance, as the WeakMap key for its class metadata. */
function ctorOf(instance: unknown): object {
  return (instance as { constructor: object }).constructor;
}

function expose(
  optionsOrValue?: AgentExposeOptions | ((...args: never[]) => unknown),
  maybeContext?: unknown,
): AgentMethodDecorator | undefined {
  if (isDecoratorContext(maybeContext)) {
    // Bare usage: `@foom.expose method() {}` — invoked as the decorator itself.
    applyExpose(undefined, maybeContext as MethodContext);
    return;
  }
  const options = optionsOrValue as AgentExposeOptions | undefined;
  const decorate = (_value: unknown, context: MethodContext): void => applyExpose(options, context);
  return decorate as unknown as AgentMethodDecorator;
}

/** Decorators live under a module-level `foom` namespace (@foom.config / @foom.expose). */
export const foom: AgentDecorators = {
  config: ((options: AgentOptions) => makeConfig(options)) as AgentConfigDecorator,
  expose: expose as unknown as AgentExposeDecorator,
};
