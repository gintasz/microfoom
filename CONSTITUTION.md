# Repository Constitution — microfoom

> Repo-level decisions that keep the codebase coherent regardless of which feature is built. It governs
> *how* code is shaped, never *what* the product does. This is the filled instance: verdicts in place,
> option-space stripped.

---

## 0. Preamble — fixed machinery (not code opinions)

Everything in §0 is fixed: adopting this kind of artifact means adopting this machinery.

**P0. What a constitution is.** A repo-level set of decisions that make the codebase coherent regardless of which feature is built. Governs *how* code is shaped, never *what* the product does.

**P1. What it is NOT.** Not a README, architecture doc, task tracker, refactoring playbook, or tutorial. No lists of specific modules, packages, functions, or files. Workflow and how-to belong in `/docs`.

**P2. Inclusion test.** A candidate belongs in the body only if two competent teams would legitimately choose differently *and* mixing within one repo causes incoherence. Auto-enforced truths are excluded; universal-but-violatable hygiene goes in BASELINE; only genuine divergent decisions are body content.

**P3. Decision tags.** `[tradeoff]` — real cost both ways, a value judgment. `[consistency]` — no right answer, the only failure is mixing.

**P4. Precedence (conflicts → higher wins).** 1. Legal / regulatory / safety · 2. Security & correctness · 3. This constitution · 4. Nearest existing code (P5) · 5. Individual preference (never wins).

**P-Values. Precedence of design virtues.** P4 orders *authority*; this orders *virtues*. When two compliant options tension on design merit (a `[tradeoff]` call, or silence under P5), the higher virtue wins, in order:
1. **Conceptual integrity** — one coherent vision over local cleverness or feature-completeness.
2. **Locality of reasoning** — a unit must be understandable without loading the whole system. This is the binding constraint, because the primary authors are AI agents with bounded context (P9).
3. **Uniformity / composability** — one idiom everywhere (Effect, the FS shape); small pieces that compose.
4. **Correctness by construction + totality** — illegal states unrepresentable, every case handled.
5. **Legibility / observability** — the system explains itself.

Deliberately **not** maximized — they yield when they conflict with the above: runtime performance (measure-first; no speculative optimization), reversibility (lock-in is accepted knowingly — X2/I3), and raw density/brevity (never bought at locality's expense). Cite a virtue by number when a tradeoff is contested in review.

**P5. The silence rule.** Where the constitution is silent, follow the dominant pattern in the nearest existing code. **Exception:** never copy a pattern that conflicts with a filled decision or a logged exception (G1) — meet the higher standard. No nearby pattern + costly to reverse → propose an amendment (P6).

**P6. Amendment process.** Rare and deliberate. Anyone (human or agent) proposes; only the **maintainer** (repo owner) ratifies. Accept only if it generalizes (passes P2) — never for one feature. Prefer a principle over an exception. Unsure → leave it out. Ratified amendments are recorded as an ADR (C3).

**P7. Rule IDs.** Stable `<SECTION><N>`. Cite in review and amendments. Never reused, even after deletion.

**P8. Enforcement tag.** Each decision names how it is checked: `tool` / `review` / `judgment`.

**P9. Automated agents.** AI agents are the primary authors here. Every agent that writes code in this repo is given this document as governing context, is bound by it, and may not override it (P4).

**P-Bias. Tool-first enforcement.** When a rule *can* be enforced by a tool (linter, type checker, import-graph/arch checker, test), it MUST be — a `review`/`judgment` tag is permitted only when no mechanical check is feasible. Adding a rule includes adding or citing its check.

**P10. Tiers.** Sections are **Core** (consult on every change) or **Conditional** (only when the change touches that concern).

**P11. Conflict protocol.** If a task seems to require violating a filled decision, **stop and report first**: rule ID, why, a compliant alternative, the risk. Resolve via amendment (P6) or a logged, time-boxed exception (G1) — never silently.

**P12. Applicability.** A section that genuinely doesn't apply is marked **`N/A — <reason>`**, never deleted.

> Domain extensions follow these same rules as new sections. The microfoom invariants are such an extension — section **F**.

---

```
╔══════════════════════════════════════════════════════════════════════╗
║ BASELINE — non-negotiable hygiene. NOT decisions. Enforced by CI.      ║
╚══════════════════════════════════════════════════════════════════════╝
```
- **B1.** No secrets in source, logs, or error messages. *(tool: secret scanner)*
- **B2.** No dead or commented-out code. *(tool: linter + dead-code checker)*
- **B3.** No raw concatenation into queries/commands/markup — parameterized/escaped APIs only. *(tool: linter)*
- **B4.** User/agent-facing messages never leak internals (stack traces, secrets, file internals). *(review)*
- **B5.** Secrets/PII never written to logs. Logging is bounded and best-effort, never a leak path. *(review)*
- **B6.** Unit tests are deterministic and order-independent. *(tool: CI)*
- **B7.** The formatter's output is authoritative — no manual restyling. *(tool: formatter, CI fails on diff)*
- **B8.** Linter and type checker run in CI; their errors block merge. *(tool: CI)*
- **B9.** No copy-paste duplication beyond the configured threshold. *(tool: duplication detector)*

---
### ▮ CORE decisions — consult on every change
---

## A. Architecture & Boundaries
*Tier: Core*

- **A1. Architectural style** `[tradeoff]` — Modular monorepo. The reusable core library and run engine are harness-agnostic and never depend on any specific agent harness; a harness is an adapter built on top of them. *(review)*
- **A2. Unit of modularity** `[consistency]` — The package. Each package exposes exactly one curated public surface (its barrel); `export *` from a barrel is banned (L3). Internals are reached only through that surface; each package's public surface is captured as a reviewable public-surface report (the reporter is named in ADR-0001) so surface changes are diffable, not silent. *(tool: linter + import-graph checker + public-surface reporter)*
- **A3. Dependency direction** `[tradeoff]` — Dependencies flow one way: from the more specific to the more generic (a harness may import the generic core; the generic core must never import a harness or anything harness-specific). No dependency cycles, ever. *(tool: import-graph checker)*
- **A4. Boundary access** `[tradeoff]` — Cross-package access goes through the package's public surface only; deep imports into another package's internals are forbidden. *(tool: import-graph checker)*
- **A5. Core/IO separation** `[tradeoff]` — Logic is a *description* (`Effect`), not an execution. No I/O, clock, randomness, or global state runs inline; effects are declared as required services (`R`) and provided as `Layer`s, executed only at the single runtime edge / public facade (F6). Effect is the permitted purity substrate — its values are referentially transparent, so the spirit of "no framework leaking into the core" is met by Effect, not violated. *(review)* — *invariant, F6, X2*
- **A6. Global/shared state** `[tradeoff]` — No module globals. Dependencies are provided as Effect services via `Context`/`Layer`; shared mutable state is an Effect `Ref` (or a scoped service), never a free-floating singleton. *(review)*

## N. Naming
*Tier: Core*

- **N1. Files & directories** `[consistency]` — snake_case file and directory names. Cohesive module per file (not one-export-per-file). *(tool: linter)*
- **N2. Identifier casing** `[consistency]` — `camelCase` values/functions, `PascalCase` types/classes, `UPPER_SNAKE_CASE` module constants. *(tool: linter)*
- **N3. Semantic conventions** `[consistency]` — Boolean predicates read `is`/`has`; functions are verb phrases; accessors/data are nouns. *(review)*
- **N4. Abbreviations** `[consistency]` — Banned except domain terms in the glossary (N5). No single-letter names except loop indices and well-scoped lambdas. *(review)*
- **N5. Ubiquitous language** `[tradeoff]` — One term per concept, used consistently across code and prompts. No maintained human glossary. Domain identifiers live in the spell-checker word-list (`project-words.txt`) purely as a spell-check allowlist so they don't false-positive while the spell checker still catches real typos. Term consistency (a non-canonical synonym) is a review concern, not auto-enforced. *(tool: spell checker + review)*

## O. Code Organization
*Tier: Core*

- **O1. Directory layout** `[consistency]` — Within a package, organize by concern / pipeline stage, not by feature and not as one flat bag. Which concerns exist is a per-package choice; the constraint is that one package does not mix layout styles. *(review)*
- **O2. Co-location** `[consistency]` — Tests live in each package's own test tree. Types co-locate with the concern they describe. *(review)*
- **O3. Size signals** `[consistency]` — File/function/parameter size are soft review signals, not hard gates. A large unit invites a justification, not an automatic block. *(judgment)*

## L. Language & Style
*Tier: Core*

- **L1. Versions & toolchain** `[consistency]` — One repo-wide toolchain, pinned in the lockfile and `package.json`: a single global choice of language, build system, package manager, schema contract, the Effect ecosystem substrate (L2), formatter, linters, import-graph and custom code-pattern enforcers, public-surface reporter, test runner, property-based-testing engine, and monorepo-hygiene gates (dead-code, duplication, version-policy, spell, commit, git-hook). TypeScript is strict + the beyond-strict flags (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`); ESM; a type-authoritative project-reference build. **The concrete members are recorded in ADR-0001, not enumerated here** — naming a specific tool or package is an instance decision, not a principle (P1/P2), and would churn this document on every swap. Adding, removing, or changing any member is a P6 amendment recorded as a new ADR (C3). *(tool: build/CI)*
- **L2. Paradigm — Effect as the substrate** `[tradeoff]` — The core is expressed in **Effect** (the `effect` library): a program is a pure, referentially-transparent `Effect<A, E, R>` value — success `A`, typed error `E`, required services `R` — that *describes* work and **runs only at the single runtime boundary at the program edge**. Effect is the one model for error handling, dependency injection, concurrency, resource management, and cancellation; the **internal** core is Effect top to bottom (X2), behind a Promise/exception facade (F6). Immutability and composition-over-inheritance hold; classes only for genuinely stateful adapters and the public API surface; mutation is the localized exception (S2). *(judgment)*
- **L3. Banned constructs** `[consistency]` — `export *` from package barrels; deep cross-package imports; `any`; non-null `!` assertions outside a justified local; module-global mutable state; and — in the internal core, not the public facade module (F6) — raw `Promise`/`async`-`await` control flow, `try`/`catch` for domain failures, any hand-rolled `Result`/`Either` type (use Effect — X2); and a floating/un-run Effect (a lazy no-op — caught by the type-aware Effect-idiom linter). *(tool: linter + custom code-pattern checker + import-graph checker + type-aware Effect-idiom linter)*

## T. Types & Data Modeling
*Tier: Core*

- **T1. Type strictness** `[tradeoff]` — Strict, plus the beyond-strict flags (L1: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`). No `any`. The stdlib is made sound with a sound-stdlib library (`JSON.parse`→`unknown`, checked indexing; named in ADR-0001). Utility types come from a canonical utility-types library, not bespoke reinvention (parsimony). Unsafe casts are confined to a single isolated vendor-wrapper module (DEP2); a cast anywhere else must surface, not be silenced. *(tool: type checker)*
- **T2. Input handling** `[tradeoff]` — Validate untrusted input once at the boundary and hand it inward as a precise type, reporting failure through Effect's typed error channel (T6/E1). The interior then trusts its types — no re-validating already-typed data. *(review)*
- **T3. Illegal states** `[tradeoff]` — Make illegal states unrepresentable: discriminated unions for outcomes/rejections (a result is one of a closed set of shapes, never a bag of optional flags). No stringly-typed status. *(review)*
- **T4. Optionality** `[consistency]` — `undefined` for absence (not `null`); optional fields are explicit and handled exhaustively at use sites. *(review)*
- **T5. Domain vs transport** `[tradeoff]` — The live in-memory model and its serializable snapshot are separate types with one projector between them. The mutable model is never put on the wire. *(review)*
- **T6. Error vocabulary** `[consistency]` — Failure is carried by **Effect's typed error channel** (the `E` in `Effect<A, E, R>`), with `Either` for pure synchronous two-state results. No hand-rolled `{ ok }`/`Result` type, no per-function result shape, no exceptions-as-control-flow internally (E1, X2). The public facade (F6) converts these to thrown errors from the public taxonomy (F7). *(review)*

## E. Errors & Failure
*Tier: Core*

- **E1. Error strategy** `[tradeoff]` — Domain failures are values in Effect's typed error channel (T6) — never thrown. Unexpected/unrecoverable conditions are Effect **defects**. A raw `throw`/`try`/`catch` appears only to wrap a foreign (non-Effect) API at the very edge, lifted immediately into the `E` channel — or at the **public facade** (F6), which converts the `E` channel into a thrown error from the public taxonomy (F7). *(review)*
- **E2. Error taxonomy** `[consistency]` — Domain errors are **tagged Effect error types**, distinct per category, so handlers match exhaustively on the tag. A deliberate program-level failure is a distinct tagged error from an infrastructure failure (the latter may be a defect); rejections are kinded (e.g. caller-fault vs environment). No raw string errors as control flow. At the public facade these map to the public error-class taxonomy the consumer catches (F7). *(review)*
- **E3. Handling locus** `[tradeoff]` — Caller-fault errors stay in the `E` channel and are recovered by tag into a retryable result without aborting the run. Infrastructure failures/defects propagate to the single runtime edge / facade that runs the Effect and finalizes the run, surfacing to the consumer as a thrown error from the public taxonomy (F6/F7). *(review)*
- **E4. Fail fast vs graceful** `[tradeoff]` — Fail fast on programmer error and contradictory program state (defects). Degrade gracefully on model-loop and limit conditions via a bounded retry policy + caps, so a faulty program can never trap a run forever. Caps live in shared policy, not per-harness. *(review)*

## S. State, Effects & Concurrency
*Tier: Core*

- **S1. Effect handling** `[tradeoff]` — Time, randomness, filesystem, and model sessions are Effect services (built-in `Clock`/`Random`; filesystem and model sessions as `Layer`s), never reached for directly. Tests provide test `Layer`s and `TestClock` — no global mocks. *(review)*
- **S2. Mutation boundary** `[tradeoff]` — Shared state lives in an Effect `Ref` and mutates through reducers only. Terminal state (final status/result) has **exactly one writer**. No other code stamps final state. *(review)*
- **S3. Concurrency model** `[tradeoff]` — Concurrency is Effect's structured concurrency (fibers), not raw `Promise`/`async` — so cancellation, timeouts, and budgets interrupt cleanly. Sibling work runs concurrently where declared; each run owns its state; nested-run accounting folds into the parent without double counting. The public surface exposes this as Promises + `AbortSignal`; stateful sessions are single-flight (overlapping turns are a programming error), with an explicit fork/branch primitive for concurrency, while stateless turns are concurrency-safe (F6). *(review)*

## Q. Testing
*Tier: Core*

- **Q1. Test scope** `[tradeoff]` — The deterministic interface layer is tested thoroughly. The LLM-interpreted behavior is exercised by real-LLM end-to-end tests, which are diagnostic, not exhaustive. *(review)*
- **Q2. Test taxonomy** `[consistency]` — Deterministic unit/integration tests gate merge. Real-LLM e2e is a separate suite (it requires a harness + live model, so it lives with the harness) that **skips** — does not fail — on provider/auth/connection errors; red there means a real regression. *(tool: CI + judgment)*
- **Q3. Test naming** `[consistency]` — Behavior-stating names (what the unit does under a condition), not implementation-naming. *(review)*
- **Q4. Layer test isolation** `[tradeoff]` — A layer's tests prove that layer without depending on a more specific layer — generic code stays verifiable without building a harness. Enforced mechanically so the boundary can't silently decay. *(tool: import-graph checker)*
- **Q5. Coverage stance** `[tradeoff]` — Coverage is a diagnostic, not a hard gate. A fix for a regression lands with a test that pins it. *(review)*
- **Q6. Property-based testing** `[tradeoff]` — The deterministic library layer (config-cascade merge, Standard-Schema validation, control-tool dispatch, cap enforcement, error mapping) is tested with property-based testing over generated inputs, not only hand-picked cases — invariants (cap monotonicity, merge associativity, totality, idempotence) must hold across many inputs. *(tool: test runner + property-based testing)*

## C. Comments & Decision Records
*Tier: Core*

- **C1. Comment policy** `[tradeoff]` — Comments explain *why*, not *what*. A module-head comment stating the module's single responsibility is expected; line comments justify non-obvious decisions. No restating the code. *(review)*
- **C2. Public docs** `[consistency]` — A package's public surface documents its intent; non-obvious exported types/functions carry a docstring. *(review)*
- **C3. ADRs** `[tradeoff]` — Significant decisions are recorded as ADRs in `docs/adr/`. Every significant or open-to-redesign choice — the control-tool naming, the config option/cascade set, the exposure-tier mechanics, harness adapters — is decided and revised through an ADR, not silently in code. Ratified amendments (P6) are ADRs too. *(review)*

---
### ▮ F. microfoom Invariants (domain extension)
*Tier: Core* — the identity of the project; violating one is not a feature, it is a different system.
---

- **F1. Deterministic host, fuzzy agent.** Orchestration — control flow, recursion, arithmetic, branching, parallelism — lives in TypeScript. The model is invoked only for genuinely fuzzy work. Driving deterministic logic through the model is an anti-pattern, not a capability to lean on. *(review)*
- **F2. Structured control, never string-matched.** The agent affects the program only through a fixed, small set of structured control operations surfaced as native function-calling; their effect is never parsed out of free-text output. Prompt prose is unconstrained; control is structured. *(review)*
- **F3. Capability security — agent-unreachable by default.** A method is not agent-callable until explicitly opted in; language-private members can never be exposed. Advertisement tiers differ only by context cost, never by privilege. *(tool: custom code-pattern checker + review)*
- **F4. Validator-agnostic structured returns.** Machine-readable returns flow through the structured channel and are validated against a **Standard Schema** (`@standard-schema/spec` is the contract; DEP2); the library commits to no concrete validator. The prose channel is never schema-validated. *(review)*
- **F5. Scoped config merges by declared discipline.** Configuration cascades from widest to narrowest scope, merging by a rule fixed per option kind: caps tighten-only (effective = the tighter of inherited/override), composable options compose, everything else is nearest-scope-wins. A cap that cannot be enforced fails fast at setup — never a silent no-op. *(review)*
- **F6. Internal Effect, conventional public surface — Effect is invisible to API users.** Effect is a maintainer-only concern. A library consumer writes idiomatic Promise/`async`/`try-catch` TypeScript and never imports, sees, or handles an Effect value or type. The internal core is Effect (X2); the public surface is Promise/`AbortSignal`-based and signals failure by throwing the typed error taxonomy (F7). The Effect↔Promise/throw conversion happens at exactly one facade seam; **no Effect type appears in any public export or generated type declaration**, and no raw Promise/throw lives behind the seam (L3/E1). *(tool: import-graph checker + public-surface reporter (Effect-free public surface) + review)*
- **F7. Typed error taxonomy.** Every failure is a subclass of one error base, discriminated by type. A deliberate in-program agent-raised error is its own class and always carries a caller-defined code; runtime-caught validation failures are a distinct class and never carry a code; caps, aborts, and boundary failures are their own subclasses. *(review)*
- **F8. Lean core, optional instrumentation.** Tracing/spans/export live behind a separate, opt-in entrypoint that augments the run context; the common path imports none of it. Core never depends on the trace surface. *(tool: import-graph checker)*

---
### ▮ CONDITIONAL decisions — consult when the change touches the concern
---

## CFG. Configuration & Environments
*Tier: Conditional*

- **CFG1. Config source** `[tradeoff]` — Behavior toggles come from the environment; no env-specific code branching beyond reading a flag. *(review)*
- **CFG2. Input validation** `[tradeoff]` — Inputs are validated at the point of use and fail with an actionable message rather than crashing. *(review)*

## DEP. Third-Party Dependencies
*Tier: Conditional*

- **DEP1. Adoption bar** `[tradeoff]` — Low. Prefer a well-maintained dependency over reimplementing non-trivial behavior, when it reduces code, or improves readability/cohesion. The cost to weigh is supply-chain and surface risk; the default lean is to adopt, and wide-surface vendors are contained by DEP2. *(review)*
- **DEP2. Vendor isolation** `[tradeoff]` — Vendors with leaky or wide surfaces are wrapped behind a single internal module, so swapping one is a one-module change. **Exception: Effect** is the internal paradigm (L2/X2), intentionally pervasive — not isolated, but it never leaks past the public facade (F6). **Schema validation commits to no vendor:** the library accepts any **Standard Schema** (`@standard-schema/spec`); concrete validators (Zod, …) are the user's dependency, never the library's (F4). *(tool: import-graph checker + review)*
- **DEP3. Version policy** `[consistency]` — Locked via the lockfile; **one version per dependency across all packages** (enforced by the version-policy checker named in ADR-0001). Upgrades are deliberate, not floating. *(tool: version-policy checker + build/CI)*

## I. Interfaces & Contracts
*Tier: Conditional*

- **I1. Contract source of truth** `[tradeoff]` — Code-first and single-sourced: the protocol surface (tool/keyword definitions, prompts, operator commands) is defined once in the generic layer; harnesses consume it, never redefine it. *(review)*
- **I2. Boundary I/O shape** `[consistency]` — Explicit request/response types at every boundary; the internal mutable model is never the boundary type (T5). *(review)*
- **I3. Compatibility policy** `[tradeoff]` — **Pragmatic / break-freely.** All consumers are in-repo; there are no external API consumers to protect. A breaking change lands with its coordinated in-repo updates in the same change. No versioned deprecation windows. (See X1.) *(review)*

## OB. Observability
*Tier: Conditional*

- **OB1. Logging** `[consistency]` — One structured, append-only log format with a single writer and a human-readable renderer (a structured-document renderer — structured documents, not ad-hoc string concat); fields are bounded so one large value can't make output unreadable. Logging is best-effort and never breaks a run. *(review)*
- **OB2. Correlation** `[consistency]` — One trace identity ties a top-level run to every nested run it spawns; correlation ids propagate through the log context. *(review)*
- **OB3. Metrics** `[consistency]` — Run accounting (token/cost usage) is recorded through the record's reducer pipeline, after each harness normalizes its native reporting into the neutral event model — no ad-hoc counters and no harness-specific accounting shape leaking into the record. Usage accumulation is a `Monoid` — empty + associative combine — folded once, not hand-summed. *(review)*

## V. Version Control & Review
*Tier: Conditional*

- **V1. Branching & commits** `[consistency]` — Short-lived branches off the default branch; no direct commits to it. The DoD gate runs locally pre-commit/pre-push via a git-hook runner. *(tool: branch protection + git-hook runner)*
- **V2. PR scope** `[tradeoff]` — Single-purpose PRs. A refactor and a feature do not ride together; a large refactor lands in reviewable slices (R2). *(review)*
- **V3. Merge gate** `[consistency]` — Green CI required (B8, Q2, Q4). Maintainer approval ratifies; an agent-authored change is reviewed against this constitution by ID before merge. *(tool: CI + branch protection)*

## R. Refactoring & Evolution
*Tier: Conditional*

- **R1. Behavior-preservation proof** `[tradeoff]` — A "behavior-preserving" refactor lands only with the deterministic tests that prove it (existing or added). *(review/tool)*
- **R2. Slice discipline** `[tradeoff]` — Large refactors land in reviewable slices, not a big bang. *(review)*
- **R3. Guard the gain** `[tradeoff]` — When a boundary is established or repaired, add the automated guard (arch rule / test) that keeps it. *(tool/review)*

---
### ▮ GOVERNANCE
---

## G. Exceptions
*Tier: Core*

- **G1. Exception register** — Every exception to a filled decision is logged (as an ADR entry) with owner, reason, containment, and a sunset trigger. An expired exception is a violation. *(review)*

---
### ▮ X. Project-Specific Mandates
---

## X. Mandates
*Tier: Core*

- **X1. No backwards compatibility.** Backwards compatibility is **prohibited**, not merely unneeded. No compatibility shims, no deprecation scaffolding, no dual code paths kept for old behavior, no "legacy" branches retained "just in case." All consumers are in-repo (I3); a change updates every call site in place. Bloat from compatibility is treated as a defect. *(review)*
- **X2. Effect internal, Promise/exception facade.** The **internal** core commits totally to Effect (L2): no parallel non-Effect mechanism for errors, DI, concurrency, resources, or cancellation; no hand-rolled `Result`; no raw `Promise`/`async` or `try`/`catch` for domain failures **behind the facade**. The public surface is the **one sanctioned facade** (F6) that converts Effect to Promise/`AbortSignal` + thrown public-taxonomy errors; no Effect type leaks past it. Effect is pervasive internally and exempt from vendor isolation (DEP2). Abandoning Effect is a full internal rewrite, accepted knowingly. *(tool: custom code-pattern checker + import-graph checker + review)*

---
### ▮ GATE
---

## DOD. Definition of Done
*Tier: Core*

Nothing merges unless **all** hold:
- **DOD1.** BASELINE clean (B1–B8 green). *(tool)*
- **DOD2.** Tests for the change exist; the deterministic suite passes; arch/dependency rules pass. *(tool)*
- **DOD3.** No filled-decision violation (cite-able by ID), or a logged G1 exception exists. Agent-authored changes are checked against this document by ID. *(review + arch tooling)*
- **DOD4.** No `TODO` without a tracked issue link. *(tool)*
- **DOD5.** ADR added/updated **only** when a decision or a public contract changed — not per task. *(review)*
