/**
 * In-process e2e harness for pi-thoughtcode, modelled on the pi-neuralyzer harness.
 *
 * Runs a real pi AgentSession with the thoughtcode extension bound — no `pi` CLI, no TUI (so terminal
 * width crashes and flaky stdout parsing are out of scope). The main agent interprets the ENTRYPOINT
 * and delegates VIBECALLs to subagents exactly as in production.
 *
 * Assertions run against:
 *  - `toolCalls` / `toolResults` captured from the main session, and
 *  - the structured debug log (`readLog()`), which deterministically records the whole nested
 *    subagent tree including VIBERETURN type rejections.
 *
 * Skips automatically when the test model has no configured auth.
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getModel } from "@earendil-works/pi-ai";
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { buildVibeCallSubagentPrompt } from "thoughtcode-core";
import thoughtcodeExtension from "../dist/index.js";

export const TEST_PROVIDER = process.env.THOUGHTCODE_TEST_PROVIDER ?? "openrouter";
export const TEST_MODEL_ID = process.env.THOUGHTCODE_TEST_MODEL ?? "deepseek/deepseek-v4-flash";

const SCRATCH_DIR = "/tmp/agentic_coding";

// Every e2e run appends here automatically (no flag). Date-stamped so each day's runs group together.
// When a scenario fails, this file shows WHY each model call ended (e.g. stopReason "error" /
// "Connection error." = provider/transport, not a code regression).
const E2E_LOG_FILE = join("/tmp/thoughtcode", `e2e-${new Date().toISOString().slice(0, 10)}.log`);
function appendE2eLog(entry: Record<string, unknown>): void {
  try {
    mkdirSync("/tmp/thoughtcode", { recursive: true });
    appendFileSync(E2E_LOG_FILE, `${JSON.stringify({ ts: new Date().toISOString(), ...entry }, null, 2)}\n`);
  } catch {
    // Logging must never break a test.
  }
}

export interface ToolResult {
  toolName: string;
  isError: boolean;
  text: string;
}

export interface LogEntry {
  runId?: string;
  depth?: number;
  kind?: string;
  [key: string]: unknown;
}

export interface ThoughtcodeHarness {
  readonly cwd: string;
  /** Write a ThoughtCode program file into the harness cwd; returns its relative path. */
  writeProgram(name: string, contents: string): Promise<string>;
  /** Prompt the main agent to execute a VIBEFUNCTION (sends the standard ENTRYPOINT prompt). */
  execute(programPath: string, function_name: string, args?: string): Promise<void>;
  /** Send raw prompt text. */
  prompt(text: string): Promise<void>;
  readonly responses: string[];
  readonly toolCalls: string[];
  readonly toolResults: ToolResult[];
  readonly diag: any[];
  /** True if any model call ended in a transport/provider error (connection, network, 5xx, timeout). */
  hadTransportError(): boolean;
  /** Parsed debug-log entries for this harness run. */
  readLog(): Promise<LogEntry[]>;
  dispose(): void;
}

export async function hasModelAuth(): Promise<boolean> {
  try {
    const model = getModel(TEST_PROVIDER, TEST_MODEL_ID);
    if (!model) return false;
    const registry = ModelRegistry.create(AuthStorage.create());
    const auth = await registry.getApiKeyAndHeaders(model);
    return Boolean(auth.ok && auth.apiKey);
  } catch {
    return false;
  }
}

function flatten(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part: any) => (part && part.type === "text" ? (part.text ?? "") : "")).join("\n");
}

export async function createThoughtcodeHarness(): Promise<ThoughtcodeHarness> {
  const model = getModel(TEST_PROVIDER, TEST_MODEL_ID);
  if (!model) throw new Error(`Model ${TEST_PROVIDER}/${TEST_MODEL_ID} not found`);

  const cwd = await mkdtemp(join(SCRATCH_DIR, "thoughtcode-e2e-"));
  const logFile = join(cwd, "debug.jsonl");
  process.env.THOUGHTCODE_DEBUG_LOG = logFile;

  const agentDir = getAgentDir();
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });

  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    authStorage,
    modelRegistry,
    settingsManager,
    resourceLoaderOptions: {
      // Hermetic: load ONLY the thoughtcode extension via the factory. The no* flags disable disk
      // discovery so the e2e never inherits the dev's globally-installed pi extensions, skills,
      // themes, prompt templates, or context files (which would change main-agent behavior per machine).
      extensionFactories: [thoughtcodeExtension as unknown as (pi: ExtensionAPI) => void],
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    },
  });

  const sessionManager = SessionManager.inMemory(cwd);
  const createRuntime = async (opts: any) => {
    const created = await createAgentSessionFromServices({
      services,
      sessionManager: opts.sessionManager,
      sessionStartEvent: opts.sessionStartEvent,
      model,
      thinkingLevel: (process.env.THOUGHTCODE_TEST_THINKING as "off" | "low" | "medium" | "high" | undefined) ?? "off",
    });
    return { ...created, services, diagnostics: [] };
  };
  const runtime: any = await createAgentSessionRuntime(createRuntime, { cwd, agentDir, sessionManager });

  const responses: string[] = [];
  const toolCalls: string[] = [];
  const toolResults: ToolResult[] = [];
  const diag: any[] = [];
  let current = "";
  let unsubscribe: (() => void) | undefined;
  const uiContext: any = new Proxy({}, { get: () => () => {} });

  const bind = async () => {
    const s = runtime.session;
    await s.bindExtensions({
      uiContext,
      mode: "tui",
      abortHandler: () => {},
      commandContextActions: {
        waitForIdle: () => s.agent.waitForIdle(),
        newSession: (o: any) => runtime.newSession(o),
        fork: (id: string, o: any) => runtime.fork(id, o),
        navigateTree: (id: string, o: any) => s.navigateTree(id, o),
        switchSession: (p: string, o: any) => runtime.switchSession(p, o),
        reload: () => Promise.resolve(),
      },
    });
    unsubscribe = s.subscribe((event: any) => {
      if (event.type === "tool_execution_start") toolCalls.push(event.toolName);
      if (event.type === "tool_execution_end") {
        toolResults.push({ toolName: event.toolName, isError: Boolean(event.isError), text: flatten(event.result?.content) });
      }
      if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
        current += event.assistantMessageEvent.delta;
      }
      if (event.type === "message_end" && event.message.role === "assistant") {
        responses.push(current);
        diag.push({
          ts: new Date().toISOString(),
          type: "message_end",
          stopReason: event.message.stopReason,
          errorMessage: event.message.errorMessage,
          finishReason: event.message.finishReason,
          text: current.slice(0, 500),
        });
        current = "";
      }
      // Surface anything error-shaped the session emits so a failed e2e shows WHY (API error vs inline prose).
      if (typeof event.type === "string" && /error/i.test(event.type)) {
        diag.push({ ts: new Date().toISOString(), type: event.type, detail: JSON.stringify(event).slice(0, 800) });
      }
    });
  };

  runtime.setRebindSession(async () => {
    unsubscribe?.();
    await bind();
  });
  await bind();

  return {
    cwd,
    async writeProgram(name, contents) {
      await writeFile(join(cwd, name), contents);
      return `./${name}`;
    },
    async prompt(text) {
      await runtime.session.prompt(text);
      await runtime.session.agent.waitForIdle();
    },
    async execute(programPath, function_name, args = "") {
      const text = buildVibeCallSubagentPrompt({ program_file_path: programPath, name: function_name, args });
      await runtime.session.prompt(text);
      await runtime.session.agent.waitForIdle();
      appendE2eLog({
        provider: TEST_PROVIDER,
        model: TEST_MODEL_ID,
        entry: function_name,
        args,
        toolCalls: [...toolCalls],
        diag: [...diag],
        responses: [...responses],
        toolResults: [...toolResults],
      });
    },
    responses,
    toolCalls,
    toolResults,
    diag,
    hadTransportError() {
      return diag.some(
        (e) =>
          e?.stopReason === "error" &&
          /connection|network|fetch|socket|ECONN|ETIMEDOUT|timeout|to(?:o)? many|502|503|504|overloaded/i.test(
            String(e?.errorMessage ?? ""),
          ),
      );
    },
    async readLog() {
      if (!existsSync(logFile)) return [];
      const text = await readFile(logFile, "utf8");
      return text
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as LogEntry);
    },
    dispose: () => unsubscribe?.(),
  };
}
