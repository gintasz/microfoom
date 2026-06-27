# Examples

## hello

A hello-world microfoom program (`hello.ts`): TypeScript orchestrates, the model
writes a greeting and returns it through the structured channel (FOOMRETURN),
schema-validated.

### Run it

Needs a model + API key configured in `~/.pi` (this example defaults to
`openrouter/deepseek/deepseek-v4-flash`; override with `MICROFOOM_MODEL`).

```bash
pnpm run example            # greets "world"
pnpm run example -- Ada     # greets "Ada"
```

`pnpm run example` runs `examples/run.ts` with `tsx` (which transpiles the
TypeScript + decorators). It opens a pi session, runs the program, and prints the
returned greeting.

To see exactly what the model did each turn (prompt, tools, tool calls, errors),
set a log file:

```bash
MICROFOOM_LOG=/tmp/microfoom/hello.jsonl pnpm run example -- Ada
cat /tmp/microfoom/hello.jsonl   # one JSON record per model turn
```

### Or, inside `pi` (the extension)

With the `@microfoom/pi/extension` installed in your pi agent, you can always run
any program ad-hoc:

```
/microfoom-run examples/hello.ts world
```

Or register programs from a config (`microfoom.json` — see this folder's sample)
so they show up as their own commands/tools. With `MICROFOOM_CONFIG` pointed at
`examples/microfoom.json`, the sample registers:

- `/hello world` — a user slash-command, and
- a `hello` **tool** the agent itself can call (params derived from the program's
  `main` input).

