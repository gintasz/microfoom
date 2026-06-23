# Distinction between ThoughtCode core & agent harness extension
In the future, ThoughtCode will have support for 20 different agent harnesses, therefore all reusable language & runtime related code must sit inside `thoughtcode-core`, whereare the harness extension like `pi-thoughtcode` should only contain minimal glue to connect the harness to the core.

# Validation

When a change is completed, always run full workspace tests, not just unit tests, not just package tests.

```bash
npm run typecheck # types only, no tests
npm test          # deterministic suite (unit + faux). Excludes e2e.
npm run test:e2e  # real-LLM e2e (dev machine must have model auth). Logs every run to /tmp/thoughtcode/e2e-<date>.log
npm run build
```

e2e skips (not fails) on provider/connection errors — red there means a real regression. The log shows why each call ended.
