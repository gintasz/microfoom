import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxThinking,
  fauxToolCall,
  getApiProvider,
  registerFauxProvider,
} from "@earendil-works/pi-ai";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  THOUGHTCODE_MISSING_VIBE_RETURN_MESSAGE,
  THOUGHTCODE_MISSING_VIBE_RETURN_PROGRESS_STEP,
  THOUGHTCODE_SYSTEM_PROMPT,
  VIBE_CALL_TOOL_NAME,
  VIBE_CALL_TOOL_PARAMETERS,
  VIBE_LOAD_PROGRAM_TOOL_NAME,
  VIBE_RETURN_TOOL_NAME,
  VIBE_RETURN_TOOL_PARAMETERS,
  VIBE_THROW_TOOL_NAME,
  buildVibeCallSubagentPrompt,
  type VibeCallArgs,
} from "thoughtcode-core";
import { beforeEach, describe, expect, it } from "vitest";
import thoughtcodeExtension, {
  clearVibeCallRunsForTests,
  createVibeReturnTool,
  createThoughtcodeTools,
  getVibeCallRun,
  inspectThoughtcodeRun,
  type VibeCallDetails,
  type VibeCallRunRecord,
  VibeThrowError,
  vibeCallTool,
  vibeReturnTool,
} from "../dist/index.js";
import { addNestedVibeCallUsage } from "thoughtcode-core";

const SCRATCH_DIR = "/tmp/agentic_coding";
const vibeCallArgs = (program_file_path: string, name: string, args: string): VibeCallArgs => ({
  program_file_path,
  name,
  args,
});
const vibePrompt = (program_file_path: string, name: string, args: string): string =>
  buildVibeCallSubagentPrompt(vibeCallArgs(program_file_path, name, args));
const plainTheme = {
  fg(_color: string, text: string) {
    return text;
  },
  bold(text: string) {
    return text;
  },
};

async function renderInspect(runId: string, width = 220): Promise<string> {
  let rendered = "";

  await inspectThoughtcodeRun(runId, {
    mode: "tui",
    ui: {
      async custom(factory: never) {
        const component = (factory as (tui: unknown, theme: unknown, keybindings: unknown, done: () => void) => {
          render(width: number): string[];
        })(
          { terminal: { rows: 32 }, requestRender() {} },
          plainTheme,
          {},
          () => {},
        );
        rendered = component.render(width).join("\n");
      },
      notify() {
        throw new Error("inspect should not notify for an existing run");
      },
    },
  } as never);

  return rendered;
}

describe("pi-thoughtcode", () => {
  beforeEach(() => {
    clearVibeCallRunsForTests();
  });

  it("exports the two Thoughtcode placeholder tools", () => {
    const tools = createThoughtcodeTools();

    expect(tools.map((tool) => tool.name)).toEqual([
      VIBE_CALL_TOOL_NAME,
      VIBE_RETURN_TOOL_NAME,
      VIBE_LOAD_PROGRAM_TOOL_NAME,
      VIBE_THROW_TOOL_NAME,
    ]);
    expect(vibeCallTool.parameters.required).toEqual(VIBE_CALL_TOOL_PARAMETERS.map((parameter) => parameter.name));
    expect(vibeReturnTool.parameters.required).toEqual(VIBE_RETURN_TOOL_PARAMETERS.map((parameter) => parameter.name));
    for (const parameter of VIBE_CALL_TOOL_PARAMETERS) {
      expect(vibeCallTool.parameters.properties[parameter.name]?.description).toBe(parameter.description);
    }
    for (const parameter of VIBE_RETURN_TOOL_PARAMETERS) {
      expect(vibeReturnTool.parameters.properties[parameter.name]?.description).toBe(parameter.description);
    }
  });

  it("registers tools through the PI extension factory", () => {
    const registered: ToolDefinition[] = [];
    const commands: string[] = [];
    let beforeAgentStart: ((event: { systemPrompt: string }) => { systemPrompt: string }) | undefined;

    thoughtcodeExtension({
      on(event, handler) {
        if (event === "before_agent_start") {
          beforeAgentStart = handler as typeof beforeAgentStart;
        }
      },
      registerTool(tool) {
        registered.push(tool);
      },
      registerCommand(name) {
        commands.push(name);
      },
    } as never);

    expect(registered.map((tool) => tool.name)).toEqual([
      VIBE_CALL_TOOL_NAME,
      VIBE_RETURN_TOOL_NAME,
      VIBE_LOAD_PROGRAM_TOOL_NAME,
      VIBE_THROW_TOOL_NAME,
    ]);
    expect(commands).toEqual(["thoughtcode-inspect", "thoughtcode-run"]);
    expect(beforeAgentStart?.({ systemPrompt: "Base prompt" }).systemPrompt).toBe(
      `Base prompt\n\n${THOUGHTCODE_SYSTEM_PROMPT}`,
    );
    expect(beforeAgentStart?.({ systemPrompt: THOUGHTCODE_SYSTEM_PROMPT }).systemPrompt).toBe(THOUGHTCODE_SYSTEM_PROMPT);
  });

  it("loads into a PI AgentSession and exposes executable tools", async () => {
    const cwd = await mkdtemp(join(SCRATCH_DIR, "thoughtcode-cwd-"));
    const agentDir = await mkdtemp(join(SCRATCH_DIR, "thoughtcode-agent-"));
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      extensionFactories: [thoughtcodeExtension],
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });

    await resourceLoader.reload();
    const { session, extensionsResult } = await createAgentSession({
      cwd,
      agentDir,
      resourceLoader,
      sessionManager: SessionManager.inMemory(cwd),
      noTools: "builtin",
    });

    try {
      expect(extensionsResult.errors).toEqual([]);
      expect(session.getAllTools().map((tool) => tool.name)).toEqual(
        expect.arrayContaining([VIBE_CALL_TOOL_NAME, VIBE_RETURN_TOOL_NAME]),
      );

      const vibeCall = session.getToolDefinition(VIBE_CALL_TOOL_NAME);
      const vibeReturn = session.getToolDefinition(VIBE_RETURN_TOOL_NAME);

      expect(vibeCall).toBeDefined();
      expect(vibeReturn).toBeDefined();
    } finally {
      session.dispose();
    }
  });

  it("spawns a subagent runner from VIBECALL and returns the VIBERETURN value", async () => {
    const expectedPrompt = vibePrompt("./program.txt", "mul", "a=3,my number=9");
    const [vibeCall] = createThoughtcodeTools({
      async runSubagent(request) {
        expect(request.call).toEqual({
          program_file_path: "./program.txt",
          name: "mul",
          args: "a=3,my number=9",
        });
        expect(request.prompt).toBe(expectedPrompt);
        expect(request.depth).toBe(1);
        expect(request.progress).toMatchObject({ status: "run", depth: 1, step: "think" });
        return "27";
      },
    });

    const callResult = await vibeCall.execute(
      "call-1",
      { program_file_path: "./program.txt", name: "mul", args: "a=3,my number=9" },
      undefined,
      undefined,
      undefined as never,
    );

    expect(callResult.content).toEqual([{ type: "text", text: "27" }]);
    expect(callResult.details).toEqual({
      kind: "vibecall",
      runId: "tc-1",
      program_file_path: "./program.txt",
      name: "mul",
      args: "a=3,my number=9",
      prompt: expectedPrompt,
      status: "done",
      depth: 1,
      progress: expect.objectContaining({
        status: "done",
        depth: 1,
        step: "done 27",
      }),
      events: [
        expect.objectContaining({ type: "thinking", text: "thinking" }),
        expect.objectContaining({ type: "return", text: "done 27" }),
      ],
      transcript: [
        expect.objectContaining({ role: "return", text: "27" }),
      ],
      result: "27",
    });
    expect(callResult.terminate).toBe(false);
  });

  it("captures VIBERETURN values and terminates the current subagent turn", async () => {
    let captured: string | undefined;
    const vibeReturn = createVibeReturnTool({
      onVibeReturn(value) {
        captured = value;
      },
    });

    const returnResult = await vibeReturn.execute(
      "return-1",
      { value: "27" },
      undefined,
      undefined,
      undefined as never,
    );

    expect(captured).toBe("27");
    expect(returnResult.content).toEqual([{ type: "text", text: "27" }]);
    expect(returnResult.details).toEqual({ kind: "vibereturn", value: "27" });
    expect(returnResult.terminate).toBe(true);
  });

  it("uses VIBERETURN as the terminal response outside a VIBECALL subagent", async () => {
    const returnResult = await vibeReturnTool.execute(
      "return-1",
      { value: "27" },
      undefined,
      undefined,
      undefined as never,
    );

    expect(returnResult.content).toEqual([{ type: "text", text: "27" }]);
    expect(returnResult.details).toEqual({ kind: "vibereturn", value: "27" });
    expect(returnResult.terminate).toBe(true);
  });

  it("renders a concise VIBECALL progress card", () => {
    const component = vibeCallTool.renderResult?.(
      {
        content: [{ type: "text", text: "tool read /tmp/agentic_coding/program.tc" }],
        details: {
          kind: "vibecall",
          runId: "tc-7",
          program_file_path: "/tmp/agentic_coding/program.tc",
          name: "main",
          args: 'x=2,y=5, payload={"items":[1,2,3,4,5,6]}',
          prompt: vibePrompt("/tmp/agentic_coding/program.tc", "main", "x=2,y=5"),
          status: "running",
          depth: 1,
          progress: {
            status: "run",
            depth: 1,
            startedAt: 0,
            endedAt: 6000,
            step: "tool read /tmp/agentic_coding/program.tc",
            usage: {
              input: 815,
              output: 87,
              cacheRead: 565,
              cacheWrite: 0,
              cost: 0.0001,
            },
          },
        },
      },
      { expanded: false, isPartial: true },
      plainTheme as never,
      { cwd: "/tmp/agentic_coding" } as never,
    );

    const output = component?.render(160).join("\n") ?? "";
    const narrowLines = component?.render(24) ?? [];

    expect(output).toContain(`${VIBE_CALL_TOOL_NAME} running 6s id=tc-7 ↑815 ↓87 R565 $0.00010`);
    expect(output).toContain("entry main  file program.tc");
    expect(narrowLines).toEqual(expect.arrayContaining(["entry main", "file program.tc"]));
    expect(output).toContain('args x=2,y=5, payload={"items":[1,2,3,4,5,6]}');
    expect(output).toContain("tool read program.tc");
    expect(output).not.toContain("d1");
    expect(output).not.toContain("run 6s d1");
    expect(output).not.toContain("depth=1");
    expect(output).not.toContain("activity");
    expect(output).not.toContain("return:");
  });

  it("renders cumulative VIBECALL usage explicitly", () => {
    const component = vibeCallTool.renderResult?.(
      {
        content: [{ type: "text", text: "done 24" }],
        details: {
          kind: "vibecall",
          runId: "tc-10",
          program_file_path: "./program2.txt",
          name: "fac",
          args: "n=4",
          prompt: vibePrompt("./program2.txt", "fac", "n=4"),
          status: "done",
          depth: 1,
          progress: {
            status: "done",
            depth: 1,
            startedAt: 0,
            endedAt: 20000,
            step: "done 24",
            usage: {
              input: 683,
              output: 468,
              cacheRead: 3600,
              cacheWrite: 0,
              cost: 0.00072,
            },
            usageCumulative: true,
          },
          result: "24",
        },
      },
      { expanded: false, isPartial: false },
      plainTheme as never,
      { cwd: "/tmp/agentic_coding" } as never,
    );

    const output = component?.render(160).join("\n") ?? "";

    expect(output).toContain("↑683 ↓468 R3.6k $0.00072 (cumulative)");
  });

  it("adds nested VIBECALL usage to the parent without double-counting updates", () => {
    const record: VibeCallRunRecord = {
      id: "tc-1",
      toolCallId: "call-1",
      call: vibeCallArgs("./program2.txt", "fac", "n=4"),
      prompt: vibePrompt("./program2.txt", "fac", "n=4"),
      status: "running",
      depth: 1,
      progress: {
        status: "run",
        depth: 1,
        startedAt: 0,
        step: "think",
        usage: {
          input: 100,
          output: 50,
          cacheRead: 10,
          cacheWrite: 0,
          cost: 0.001,
        },
      },
      events: [],
      transcript: [],
      nestedUsageByRunId: new Map(),
      startedAt: 0,
    };

    const childDetails: VibeCallDetails = {
      kind: "vibecall",
      runId: "tc-2",
      program_file_path: "./program2.txt",
      name: "fac",
      args: "n=3",
      prompt: vibePrompt("./program2.txt", "fac", "n=3"),
      status: "running",
      depth: 2,
      progress: {
        status: "run",
        depth: 2,
        startedAt: 0,
        step: "think",
        usage: {
          input: 20,
          output: 10,
          cacheRead: 5,
          cacheWrite: 1,
          cost: 0.002,
        },
      },
    };

    expect(addNestedVibeCallUsage(record, childDetails)).toBe(true);
    expect(addNestedVibeCallUsage(record, childDetails)).toBe(false);
    expect(addNestedVibeCallUsage(record, {
      ...childDetails,
      progress: {
        ...childDetails.progress,
        usage: {
          input: 25,
          output: 12,
          cacheRead: 6,
          cacheWrite: 1,
          cost: 0.003,
        },
      },
    })).toBe(true);

    expect(record.progress.usage).toEqual({
      input: 125,
      output: 62,
      cacheRead: 16,
      cacheWrite: 1,
      cost: 0.004,
    });
    expect(record.progress.usageCumulative).toBe(true);
  });

  it("renders empty VIBECALL args and thinking state explicitly", () => {
    const component = vibeCallTool.renderResult?.(
      {
        content: [{ type: "text", text: "think" }],
        details: {
          kind: "vibecall",
          runId: "tc-8",
          program_file_path: "./program1.txt",
          name: "main",
          args: "",
          prompt: vibePrompt("./program1.txt", "main", ""),
          status: "running",
          depth: 1,
          progress: {
            status: "run",
            depth: 1,
            startedAt: 0,
            endedAt: 6000,
            step: "think",
          },
        },
      },
      { expanded: false, isPartial: true },
      plainTheme as never,
      { cwd: "/tmp/agentic_coding" } as never,
    );

    const output = component?.render(120).join("\n") ?? "";
    const lines = output.split("\n").map((line) => line.trimEnd());

    expect(output).toContain(`${VIBE_CALL_TOOL_NAME} running 6s id=tc-8`);
    expect(output).toContain("entry main");
    expect(output).toContain("file ./program1.txt");
    expect(output).toContain("args <empty>");
    expect(lines).toContain("thinking");
    expect(lines).not.toContain("think");
    expect(output).not.toContain("d1");
    expect(output).not.toContain("depth=1");
  });

  it("renders expanded VIBECALL transcript without dumping raw events", () => {
    const component = vibeCallTool.renderResult?.(
      {
        content: [{ type: "text", text: "done 24" }],
        details: {
          kind: "vibecall",
          runId: "tc-9",
          program_file_path: "./program2.txt",
          name: "fac",
          args: "n=4",
          prompt: vibePrompt("./program2.txt", "fac", "n=4"),
          status: "done",
          depth: 1,
          progress: {
            status: "done",
            depth: 1,
            startedAt: 0,
            endedAt: 72000,
            step: "done 24",
          },
          transcript: [
            { t: 1, role: "assistant", text: "Now I have the result of fac(2), which is 2." },
            { t: 2, role: "tool", text: "VIBERETURN 24" },
            { t: 3, role: "return", text: "24" },
          ],
          result: "24",
        },
      },
      { expanded: true, isPartial: false },
      plainTheme as never,
      { cwd: "/tmp/agentic_coding" } as never,
    );

    const output = component?.render(160).join("\n") ?? "";

    expect(output).toContain(`${VIBE_CALL_TOOL_NAME} done 1m12s id=tc-9`);
    expect(output).toContain("debug");
    expect(output).toContain("depth 1");
    expect(output).not.toContain("prompt ENTRYPOINT = fac ENTRYPOINT_ARGS = n=4");
    expect(output).toContain("Subagent");
    expect(output).toContain("User");
    expect(output).toContain("ENTRYPOINT = fac");
    expect(output).toContain("ENTRYPOINT_ARGS = n=4");
    expect(output).toContain("Assistant");
    expect(output).toContain("Now I have the result of fac(2), which is 2.");
    expect(output).toContain("Tool");
    expect(output).toContain("VIBERETURN 24");
    expect(output).toContain("Return");
    expect(output).toContain("24");
    expect(output).not.toContain("events");
    expect(output).not.toContain("depth=1");
    expect(output).not.toContain("responding responding");
    expect(output).not.toContain("tool tool");
  });

  it("opens a read-only inspector overlay for a VIBECALL run", async () => {
    const [vibeCall] = createThoughtcodeTools({
      async runSubagent() {
        return "27";
      },
    });
    const callResult = await vibeCall.execute(
      "call-1",
      { program_file_path: "./program.txt", name: "mul", args: "a=3,my number=9" },
      undefined,
      undefined,
      { cwd: "/tmp/agentic_coding" } as never,
    );
    const rendered = await renderInspect(callResult.details.runId);

    expect(rendered).toContain("Thoughtcode tc-1 done");
    expect(rendered).toContain("entry mul");
    expect(rendered).toContain("file ./program.txt");
    expect(rendered).toContain("args a=3,my number=9");
    for (const line of buildVibeCallSubagentPrompt(callResult.details).split("\n")) {
      expect(rendered).toContain(line);
    }
    expect(rendered).toContain("Return");
    expect(rendered).toContain("27");
    expect(rendered).not.toContain("return done 27");
    expect(rendered).not.toContain("thinking thinking");
  });

  it("renders a missing return failure once in the inspector", async () => {
    const [vibeCall] = createThoughtcodeTools({
      async runSubagent(request) {
        request.progress.status = "fail";
        request.progress.endedAt = Date.now();
        request.progress.step = THOUGHTCODE_MISSING_VIBE_RETURN_PROGRESS_STEP;
        throw new Error(THOUGHTCODE_MISSING_VIBE_RETURN_MESSAGE);
      },
    });
    const callResult = await vibeCall.execute(
      "call-1",
      { program_file_path: "./program.txt", name: "mul", args: "a=3,my number=9" },
      undefined,
      undefined,
      { cwd: "/tmp/agentic_coding" } as never,
    );
    const rendered = await renderInspect(callResult.details.runId);

    expect(callResult.details.status).toBe("error");
    expect(rendered).toContain("Thoughtcode tc-1 failed");
    expect(rendered).not.toContain(THOUGHTCODE_MISSING_VIBE_RETURN_PROGRESS_STEP.replace(/^fail /, ""));
    expect(rendered.split(THOUGHTCODE_MISSING_VIBE_RETURN_MESSAGE).length - 1).toBe(1);
  });

  it("captures child-session reasoning and VIBERETURN in the inspector transcript", async () => {
    const faux = registerFauxProvider({
      api: "thoughtcode-faux-api",
      provider: "thoughtcode-faux",
      models: [{ id: "thoughtcode-faux-model" }],
    });
    const cwd = await mkdtemp(join(SCRATCH_DIR, "thoughtcode-cwd-"));
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey("thoughtcode-faux", "test-key");
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const streamSimple = getApiProvider(faux.api)?.streamSimple;

    if (!streamSimple) {
      throw new Error("Faux provider did not register a stream.");
    }

    modelRegistry.registerProvider("thoughtcode-faux", {
      api: faux.api,
      apiKey: "test-key",
      baseUrl: "http://localhost:0",
      streamSimple,
      models: [
        {
          id: "thoughtcode-faux-model",
          name: "Thoughtcode Faux Model",
          reasoning: true,
          input: ["text", "image"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 16384,
        },
      ],
    });
    const model = modelRegistry.find("thoughtcode-faux", "thoughtcode-faux-model");

    if (!model) {
      throw new Error("Registered faux model was not found.");
    }

    faux.setResponses([
      fauxAssistantMessage([fauxThinking("Need to return the computed value."), fauxToolCall(VIBE_RETURN_TOOL_NAME, { value: "27" })], {
        stopReason: "toolUse",
      }),
    ]);

    try {
      const [vibeCall] = createThoughtcodeTools();
      const result = await vibeCall.execute(
        "call-1",
        {
          program_file_path: "./program.txt",
          name: "mul",
          args: "a=3,my number=9",
        },
        undefined,
        undefined,
        {
          cwd,
          model,
          modelRegistry,
        } as never,
      );
      const run = getVibeCallRun(result.details.runId);
      const rendered = await renderInspect(result.details.runId, 100);

      expect(result.content).toEqual([{ type: "text", text: "27" }]);
      expect(run?.transcript).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: "thinking", text: "Need to return the computed value." }),
        expect.objectContaining({ role: "tool", text: `${VIBE_RETURN_TOOL_NAME} 27` }),
        expect.objectContaining({ role: "return", text: "27" }),
      ]));
      expect(rendered).toContain("Reasoning");
      expect(rendered).toContain("Need to return the computed value.");
      expect(rendered).toContain("Tool");
      expect(rendered).toContain(`${VIBE_RETURN_TOOL_NAME} 27`);
      expect(rendered).not.toContain("Thinking...");
      expect(faux.state.callCount).toBe(1);
      expect(faux.getPendingResponseCount()).toBe(0);
    } finally {
      faux.unregister();
    }
  });

  it("shows nested VIBECALL run ids in the parent inspector transcript", async () => {
    const faux = registerFauxProvider({
      api: "thoughtcode-nested-faux-api",
      provider: "thoughtcode-nested-faux",
      models: [{ id: "thoughtcode-nested-faux-model" }],
    });
    const cwd = await mkdtemp(join(SCRATCH_DIR, "thoughtcode-cwd-"));
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey("thoughtcode-nested-faux", "test-key");
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const streamSimple = getApiProvider(faux.api)?.streamSimple;

    if (!streamSimple) {
      throw new Error("Faux provider did not register a stream.");
    }

    modelRegistry.registerProvider("thoughtcode-nested-faux", {
      api: faux.api,
      apiKey: "test-key",
      baseUrl: "http://localhost:0",
      streamSimple,
      models: [
        {
          id: "thoughtcode-nested-faux-model",
          name: "Thoughtcode Nested Faux Model",
          reasoning: false,
          input: ["text", "image"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 16384,
        },
      ],
    });
    const model = modelRegistry.find("thoughtcode-nested-faux", "thoughtcode-nested-faux-model");

    if (!model) {
      throw new Error("Registered faux model was not found.");
    }

    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall(VIBE_CALL_TOOL_NAME, {
          program_file_path: "./program.txt",
          name: "inner",
          args: "x=1",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxToolCall(VIBE_RETURN_TOOL_NAME, { value: "inner-result" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(fauxToolCall(VIBE_RETURN_TOOL_NAME, { value: "outer-result" }), {
        stopReason: "toolUse",
      }),
    ]);

    try {
      const [vibeCall] = createThoughtcodeTools();
      const result = await vibeCall.execute(
        "call-1",
        {
          program_file_path: "./program.txt",
          name: "outer",
          args: "",
        },
        undefined,
        undefined,
        {
          cwd,
          model,
          modelRegistry,
        } as never,
      );
      const parentRun = getVibeCallRun(result.details.runId);
      const rendered = await renderInspect(result.details.runId, 120);

      expect(result.content).toEqual([{ type: "text", text: "outer-result" }]);
      expect(getVibeCallRun("tc-2")).toBeDefined();
      expect(parentRun?.transcript).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: "tool", text: `${VIBE_CALL_TOOL_NAME} id=tc-2 inner x=1` }),
        expect.objectContaining({ role: "return", text: "outer-result" }),
      ]));
      expect(rendered).toContain(`${VIBE_CALL_TOOL_NAME} id=tc-2 inner x=1`);
    } finally {
      faux.unregister();
    }
  });

  it("rejects a wrong-typed VIBERETURN against the program's declared type and retries deterministically", async () => {
    const faux = registerFauxProvider({
      api: "thoughtcode-typecheck-faux-api",
      provider: "thoughtcode-typecheck-faux",
      models: [{ id: "thoughtcode-typecheck-faux-model" }],
    });
    const cwd = await mkdtemp(join(SCRATCH_DIR, "thoughtcode-cwd-"));
    // `fac` declares an integer return; the subagent's VIBERETURN tool is wired to that type via
    // resolveReturnType, so a non-integer value must be rejected and force a retry — without a real LLM.
    await writeFile(
      join(cwd, "program.txt"),
      ["VIBEFUNCTION main()", "VIBEFUNCTION fac(n: number) -> number.integer", "    VIBERETURN(n)", ""].join("\n"),
    );
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey("thoughtcode-typecheck-faux", "test-key");
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const streamSimple = getApiProvider(faux.api)?.streamSimple;

    if (!streamSimple) {
      throw new Error("Faux provider did not register a stream.");
    }

    modelRegistry.registerProvider("thoughtcode-typecheck-faux", {
      api: faux.api,
      apiKey: "test-key",
      baseUrl: "http://localhost:0",
      streamSimple,
      models: [
        {
          id: "thoughtcode-typecheck-faux-model",
          name: "Thoughtcode Typecheck Faux Model",
          reasoning: false,
          input: ["text", "image"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 16384,
        },
      ],
    });
    const model = modelRegistry.find("thoughtcode-typecheck-faux", "thoughtcode-typecheck-faux-model");

    if (!model) {
      throw new Error("Registered faux model was not found.");
    }

    // First a value that violates the declared int type (rejected → tool error), then a valid one.
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall(VIBE_RETURN_TOOL_NAME, { value: "hello" }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall(VIBE_RETURN_TOOL_NAME, { value: "2" }), { stopReason: "toolUse" }),
    ]);

    try {
      const [vibeCall] = createThoughtcodeTools();
      const result = await vibeCall.execute(
        "call-1",
        { program_file_path: "./program.txt", name: "fac", args: "n=2" },
        undefined,
        undefined,
        { cwd, model, modelRegistry } as never,
      );

      // The wrong-typed return was rejected, so the model had to be invoked a second time.
      expect(result.content).toEqual([{ type: "text", text: "2" }]);
      expect(faux.state.callCount).toBe(2);
      expect(faux.getPendingResponseCount()).toBe(0);
    } finally {
      faux.unregister();
    }
  });

  it("fails the VIBECALL when @model requests an unavailable model", async () => {
    const cwd = await mkdtemp(join(SCRATCH_DIR, "thoughtcode-cwd-"));
    await writeFile(
      join(cwd, "program.txt"),
      ['@model("does-not-exist")', "VIBEFUNCTION fac(n: number)", "    VIBERETURN(n)", ""].join("\n"),
    );

    const [vibeCall] = createThoughtcodeTools();
    const result = await vibeCall.execute(
      "call-1",
      { program_file_path: "./program.txt", name: "fac", args: "n=2" },
      undefined,
      undefined,
      { cwd, model: {}, modelRegistry: { getAll: () => [] } } as never,
    );

    expect(result.details.status).toBe("error");
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("does-not-exist") });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("not available") });
  });

  it("maps a callee VIBETHROW to a VIBECALL 'threw' error result", async () => {
    const [vibeCall] = createThoughtcodeTools({
      async runSubagent() {
        throw new VibeThrowError("PROGRAM ERROR: contradictory instructions");
      },
    });
    const result = await vibeCall.execute(
      "call-1",
      { program_file_path: "./program.txt", name: "fac", args: "" },
      undefined,
      undefined,
      { cwd: SCRATCH_DIR } as never,
    );

    expect(result.content).toEqual([{ type: "text", text: "VIBECALL threw: PROGRAM ERROR: contradictory instructions" }]);
    expect(result.details.status).toBe("error");
    expect(result.details.thrown).toBe(true);
  });

  it("does not mark an infrastructure failure as thrown", async () => {
    const [vibeCall] = createThoughtcodeTools({
      async runSubagent() {
        throw new Error("Connection error.");
      },
    });
    const result = await vibeCall.execute(
      "call-1",
      { program_file_path: "./program.txt", name: "fac", args: "" },
      undefined,
      undefined,
      { cwd: SCRATCH_DIR } as never,
    );

    expect(result.content).toEqual([{ type: "text", text: "VIBECALL error: Connection error." }]);
    expect(result.details.thrown).toBeUndefined();
  });

  it("captures a subagent VIBETHROW and surfaces it through the VIBECALL boundary", async () => {
    const faux = registerFauxProvider({
      api: "thoughtcode-throw-faux-api",
      provider: "thoughtcode-throw-faux",
      models: [{ id: "thoughtcode-throw-faux-model" }],
    });
    const cwd = await mkdtemp(join(SCRATCH_DIR, "thoughtcode-cwd-"));
    await writeFile(
      join(cwd, "program.txt"),
      ["VIBEFUNCTION main()", "VIBEFUNCTION fac(n: number)", "    VIBERETURN(n)", ""].join("\n"),
    );
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey("thoughtcode-throw-faux", "test-key");
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const streamSimple = getApiProvider(faux.api)?.streamSimple;

    if (!streamSimple) {
      throw new Error("Faux provider did not register a stream.");
    }

    modelRegistry.registerProvider("thoughtcode-throw-faux", {
      api: faux.api,
      apiKey: "test-key",
      baseUrl: "http://localhost:0",
      streamSimple,
      models: [
        {
          id: "thoughtcode-throw-faux-model",
          name: "Thoughtcode Throw Faux Model",
          reasoning: false,
          input: ["text", "image"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 16384,
        },
      ],
    });
    const model = modelRegistry.find("thoughtcode-throw-faux", "thoughtcode-throw-faux-model");

    if (!model) {
      throw new Error("Registered faux model was not found.");
    }

    faux.setResponses([
      fauxAssistantMessage(fauxToolCall(VIBE_THROW_TOOL_NAME, { message: "RUNTIME ERROR: cannot reach service" }), {
        stopReason: "toolUse",
      }),
    ]);

    try {
      const [vibeCall] = createThoughtcodeTools();
      const result = await vibeCall.execute(
        "call-1",
        { program_file_path: "./program.txt", name: "fac", args: "n=2" },
        undefined,
        undefined,
        { cwd, model, modelRegistry } as never,
      );

      expect(result.content).toEqual([{ type: "text", text: "VIBECALL threw: RUNTIME ERROR: cannot reach service" }]);
      expect(result.details.thrown).toBe(true);
    } finally {
      faux.unregister();
    }
  });
});

describe("decorator enforcement (runtime side-effects)", () => {
  interface FauxSetup {
    faux: ReturnType<typeof registerFauxProvider>;
    modelRegistry: ModelRegistry;
  }

  function setupFaux(
    id: string,
    modelIds: string[],
    options: { tokensPerSecond?: number; reasoning?: boolean; tokenSize?: { min?: number; max?: number } } = {},
  ): FauxSetup {
    const models = modelIds.map((modelId) => ({ id: modelId }));
    const faux = registerFauxProvider({
      api: `${id}-api`,
      provider: id,
      models,
      tokensPerSecond: options.tokensPerSecond,
      tokenSize: options.tokenSize,
    });
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(id, "test-key");
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const streamSimple = getApiProvider(faux.api)?.streamSimple;
    if (!streamSimple) throw new Error("Faux provider did not register a stream.");
    modelRegistry.registerProvider(id, {
      api: faux.api,
      apiKey: "test-key",
      baseUrl: "http://localhost:0",
      streamSimple,
      models: modelIds.map((modelId) => ({
        id: modelId,
        name: modelId,
        reasoning: options.reasoning ?? false,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      })),
    });
    return { faux, modelRegistry };
  }

  async function writeProgram(contents: string): Promise<string> {
    const cwd = await mkdtemp(join(SCRATCH_DIR, "thoughtcode-cwd-"));
    await writeFile(join(cwd, "program.txt"), contents);
    return cwd;
  }

  // The faux provider hard-codes cost: 0. Wrap its stream to stamp a fixed total cost on every
  // message-bearing event so @budget can actually be tripped.
  function withCost(base: NonNullable<ReturnType<typeof getApiProvider>>["streamSimple"], total: number) {
    return (model: never, context: never, options: never) => {
      const inner = base(model, context, options);
      const out = createAssistantMessageEventStream();
      void (async () => {
        for await (const event of inner) {
          const message =
            event.type === "done" ? event.message : event.type === "error" ? event.error : event.partial;
          if (message?.usage) {
            message.usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total } };
          }
          out.push(event);
        }
      })();
      return out;
    };
  }

  it("@model runs the decorated model instead of the parent's", async () => {
    const { faux, modelRegistry } = setupFaux("tc-modelpick", ["tc-modelpick-A", "tc-modelpick-B"]);
    const cwd = await writeProgram(['@model("tc-modelpick-B")', "VIBEFUNCTION fac(n: number)", "    VIBERETURN(n)", ""].join("\n"));
    const parentModel = modelRegistry.find("tc-modelpick", "tc-modelpick-A");
    let usedModel: string | undefined;
    faux.setResponses([
      (_context, _options, _state, model) => {
        usedModel = model.id;
        return fauxAssistantMessage(fauxToolCall(VIBE_RETURN_TOOL_NAME, { value: "7" }), { stopReason: "toolUse" });
      },
    ]);

    try {
      const [vibeCall] = createThoughtcodeTools();
      const result = await vibeCall.execute(
        "call-1",
        { program_file_path: "./program.txt", name: "fac", args: "n=7" },
        undefined,
        undefined,
        { cwd, model: parentModel, modelRegistry } as never,
      );
      expect(usedModel).toBe("tc-modelpick-B");
      expect(result.content).toEqual([{ type: "text", text: "7" }]);
    } finally {
      faux.unregister();
    }
  });

  it("@thinking sets the subagent reasoning level", async () => {
    const { faux, modelRegistry } = setupFaux("tc-think", ["tc-think-model"], { reasoning: true });
    const cwd = await writeProgram(['@thinking("high")', "VIBEFUNCTION fac(n: number)", "    VIBERETURN(n)", ""].join("\n"));
    const model = modelRegistry.find("tc-think", "tc-think-model");
    let reasoning: unknown;
    faux.setResponses([
      (_context, options) => {
        reasoning = (options as { reasoning?: unknown } | undefined)?.reasoning;
        return fauxAssistantMessage(fauxToolCall(VIBE_RETURN_TOOL_NAME, { value: "1" }), { stopReason: "toolUse" });
      },
    ]);

    try {
      const [vibeCall] = createThoughtcodeTools();
      await vibeCall.execute(
        "call-1",
        { program_file_path: "./program.txt", name: "fac", args: "n=1" },
        undefined,
        undefined,
        { cwd, model, modelRegistry } as never,
      );
      expect(reasoning).toBe("high");
    } finally {
      faux.unregister();
    }
  });

  it("@timeout aborts a slow run and surfaces a throw", async () => {
    // Small 1-token chunks at 50 tok/s (~20ms each) so the abort is caught between chunks shortly after
    // the 0.2s timer fires — a single huge chunk would block on an un-abortable setTimeout.
    const { faux, modelRegistry } = setupFaux("tc-timeout", ["tc-timeout-model"], {
      tokensPerSecond: 50,
      tokenSize: { min: 1, max: 1 },
    });
    const cwd = await writeProgram(["@timeout(0.2)", "VIBEFUNCTION fac(n: number)", "    VIBERETURN(n)", ""].join("\n"));
    const model = modelRegistry.find("tc-timeout", "tc-timeout-model");
    // ~600 tokens at 50/s ≈ 12s of streaming, far longer than the 0.2s timeout, so the timer fires first.
    faux.setResponses([fauxAssistantMessage("x".repeat(2400))]);

    try {
      const [vibeCall] = createThoughtcodeTools();
      const result = await vibeCall.execute(
        "call-1",
        { program_file_path: "./program.txt", name: "fac", args: "n=1" },
        undefined,
        undefined,
        { cwd, model, modelRegistry } as never,
      );
      expect(result.content[0]).toMatchObject({ text: expect.stringContaining("exceeded its 0.2s timeout") });
      expect(result.details.thrown).toBe(true);
    } finally {
      faux.unregister();
    }
  });

  it("@budget aborts the run when cost exceeds the limit", async () => {
    const id = "tc-budget";
    const faux = registerFauxProvider({ api: `${id}-api`, provider: id, models: [{ id: `${id}-model` }] });
    const base = getApiProvider(faux.api)?.streamSimple;
    if (!base) throw new Error("Faux provider did not register a stream.");
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(id, "test-key");
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    modelRegistry.registerProvider(id, {
      api: faux.api,
      apiKey: "test-key",
      baseUrl: "http://localhost:0",
      streamSimple: withCost(base, 5) as never,
      models: [
        {
          id: `${id}-model`,
          name: `${id}-model`,
          reasoning: false,
          input: ["text", "image"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 16384,
        },
      ],
    });
    const model = modelRegistry.find(id, `${id}-model`);
    const cwd = await writeProgram(["@budget(0.01)", "VIBEFUNCTION fac(n: number)", "    VIBERETURN(n)", ""].join("\n"));
    faux.setResponses([fauxAssistantMessage(fauxToolCall(VIBE_RETURN_TOOL_NAME, { value: "1" }), { stopReason: "toolUse" })]);

    try {
      const [vibeCall] = createThoughtcodeTools();
      const result = await vibeCall.execute(
        "call-1",
        { program_file_path: "./program.txt", name: "fac", args: "n=1" },
        undefined,
        undefined,
        { cwd, model, modelRegistry } as never,
      );
      expect(result.content[0]).toMatchObject({ text: expect.stringContaining("exceeded its $0.01 cost budget") });
      expect(result.details.thrown).toBe(true);
    } finally {
      faux.unregister();
    }
  });

  it("@budget sums the whole subtree into the cost the check reads", () => {
    // Faux always reports $0 cost, so a true budget-abort can't be driven end-to-end here. Instead pin
    // the invariant that nested VIBECALL cost folds into progress.usage.cost — the field @budget reads —
    // delta-based and recursively (each level's usage is already cumulative).
    const record = { progress: { usage: undefined }, nestedUsageByRunId: new Map() } as never as Parameters<
      typeof addNestedVibeCallUsage
    >[0];
    const childDetails = (cost: number) =>
      ({
        runId: "child-1",
        progress: { usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost } },
      }) as never;

    addNestedVibeCallUsage(record, childDetails(5));
    expect(record.progress.usage?.cost).toBe(5);
    // child's cumulative cost grows to 8 (e.g. it made its own nested call) → only the +3 delta folds in.
    addNestedVibeCallUsage(record, childDetails(8));
    expect(record.progress.usage?.cost).toBe(8);
  });
});
