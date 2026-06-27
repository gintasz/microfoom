# @microfoom/pi

The reference microfoom harness, over the [pi](https://github.com/earendil-works/pi)
agent. Thin glue: it implements the core's `HarnessSession` port so microfoom
programs run against a real model, and ships the `/microfoom-run` pi extension.

## Programmatic use

```ts
import { runProgram } from "@microfoom/core";
import { createPiOpenSession } from "@microfoom/pi";

const result = await runProgram(MyProgram, input, {
  openSession: createPiOpenSession(), // model + API key resolved from ~/.pi
  model: "openrouter/deepseek/deepseek-v4-flash",
  sourceFile: "./my-program.ts",
});
```

Each turn runs a `pi-agent-core` `Agent` whose loop owns the model calls and
executes the FOOM operations as native pi tools; a microfoom `session()` reuses one
`Agent` so the transcript carries across turns. `createPiOpenSession` accepts
overrides (`models` / `resolveModel` / `resolveApiKey` / `logFile`) for tests or
custom wiring.

### Run logging

Set `MICROFOOM_LOG` (or `createPiOpenSession({ logFile })`) to append a JSONL
record per model turn — prompt, advertised tools, the assistant/tool messages, and
any error. Best-effort and bounded; the first thing to check when a run misbehaves.

## As a pi extension

`@microfoom/pi/extension` is an `ExtensionFactory` (default export) that registers a
command. Install it into your `pi` agent, then:

```
/microfoom-run <program-path> [json-input]
```

It loads the program's default export, runs it against a programmatic pi
sub-session, and reports the result.

### Registering programs from a config

Point `MICROFOOM_CONFIG` (or drop a `microfoom.json` in the cwd) to register a
curated set of programs as commands and/or agent tools:

```json
{
  "model": "openrouter/deepseek/deepseek-v4-flash",
  "programs": [
    { "type": "command", "path": "examples/hello.ts" },
    { "type": "tool", "path": "examples/hello.ts", "name": "hello", "description": "Greet a name." }
  ]
}
```

- `type: "command"` → a user slash-command `/<name>` (default name = filename stem).
- `type: "tool"` → an agent-callable tool; the LLM in your session can invoke the
  whole program (parameters derived from its `main` input). Use the both-pattern —
  two entries sharing a name — to expose a program as command *and* tool.
- `model` is a default; a program's own `@foom.config` model wins. Duplicate names
  are rejected per namespace.

### Run logging
