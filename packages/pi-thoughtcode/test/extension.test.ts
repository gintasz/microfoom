import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxToolCall, getApiProvider, registerFauxProvider } from "@earendil-works/pi-ai";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import thoughtcodeExtension, {
  createVibeReturnTool,
  createThoughtcodeTools,
  runThoughtcodeSubagent,
  vibeCallTool,
  vibeReturnTool,
} from "../dist/index.js";

const SCRATCH_DIR = "/tmp/agentic_coding";
const plainTheme = {
  fg(_color: string, text: string) {
    return text;
  },
  bold(text: string) {
    return text;
  },
};

describe("pi-thoughtcode", () => {
  it("exports the two Thoughtcode placeholder tools", () => {
    const tools = createThoughtcodeTools();

    expect(tools.map((tool) => tool.name)).toEqual(["VIBECALL", "VIBERETURN"]);
    expect(vibeCallTool.parameters.required).toEqual(["program_file_path", "name", "args"]);
    expect(vibeReturnTool.parameters.required).toEqual(["value"]);
  });

  it("registers tools through the PI extension factory", () => {
    const registered: ToolDefinition[] = [];

    thoughtcodeExtension({
      registerTool(tool) {
        registered.push(tool);
      },
    } as never);

    expect(registered.map((tool) => tool.name)).toEqual(["VIBECALL", "VIBERETURN"]);
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
        expect.arrayContaining(["VIBECALL", "VIBERETURN"]),
      );

      const vibeCall = session.getToolDefinition("VIBECALL");
      const vibeReturn = session.getToolDefinition("VIBERETURN");

      expect(vibeCall).toBeDefined();
      expect(vibeReturn).toBeDefined();
    } finally {
      session.dispose();
    }
  });

  it("spawns a subagent runner from VIBECALL and returns the VIBERETURN value", async () => {
    const expectedPrompt = [
      "ENTRYPOINT = mul",
      "ENTRYPOINT_ARGS = a=3,my number=9",
      "Read ./program.txt and literally execute it as if you were an interpreted.",
    ].join("\n");
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

  it("does not terminate when VIBERETURN is called outside a VIBECALL subagent", async () => {
    const returnResult = await vibeReturnTool.execute(
      "return-1",
      { value: "27" },
      undefined,
      undefined,
      undefined as never,
    );

    expect(returnResult.content).toEqual([
      { type: "text", text: "VIBERETURN ignored outside VIBECALL subagent: 27" },
    ]);
    expect(returnResult.details).toEqual({ kind: "vibereturn", value: "27" });
    expect(returnResult.terminate).toBe(false);
  });

  it("renders a concise VIBECALL progress card", () => {
    const component = vibeCallTool.renderResult?.(
      {
        content: [{ type: "text", text: "tool read /tmp/agentic_coding/program.tc" }],
        details: {
          kind: "vibecall",
          program_file_path: "/tmp/agentic_coding/program.tc",
          name: "main",
          args: 'x=2,y=5, payload={"items":[1,2,3,4,5,6]}',
          prompt: [
            "ENTRYPOINT = main",
            "ENTRYPOINT_ARGS = x=2,y=5",
            "Read /tmp/agentic_coding/program.tc and literally execute it as if you were an interpreted.",
          ].join("\n"),
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

    expect(output).toContain("VIBECALL running 6s depth=1 ↑815 ↓87 R565 $0.00010");
    expect(output).toContain("entry main");
    expect(output).toContain("file program.tc");
    expect(output).toContain('args x=2,y=5, payload={"items":[1,2,3,4,5,6]}');
    expect(output).toContain("tool read program.tc");
    expect(output).not.toContain("d1");
    expect(output).not.toContain("run 6s d1");
    expect(output).not.toContain("activity");
    expect(output).not.toContain("return:");
  });

  it("renders empty VIBECALL args and thinking state explicitly", () => {
    const component = vibeCallTool.renderResult?.(
      {
        content: [{ type: "text", text: "think" }],
        details: {
          kind: "vibecall",
          program_file_path: "./program1.txt",
          name: "main",
          args: "",
          prompt: [
            "ENTRYPOINT = main",
            "ENTRYPOINT_ARGS = ",
            "Read ./program1.txt and literally execute it as if you were an interpreted.",
          ].join("\n"),
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

    expect(output).toContain("VIBECALL running 6s depth=1");
    expect(output).toContain("entry main");
    expect(output).toContain("file ./program1.txt");
    expect(output).toContain("args <empty>");
    expect(lines).toContain("thinking");
    expect(lines).not.toContain("think");
    expect(output).not.toContain("d1");
  });

  it("runs a PI child session until the child calls VIBERETURN", async () => {
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
          reasoning: false,
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
      fauxAssistantMessage(fauxToolCall("VIBERETURN", { value: "27" }), {
        stopReason: "toolUse",
      }),
    ]);

    try {
      const result = await runThoughtcodeSubagent({
        toolCallId: "call-1",
        call: {
          program_file_path: "./program.txt",
          name: "mul",
          args: "a=3,my number=9",
        },
        prompt: [
          "ENTRYPOINT = mul",
          "ENTRYPOINT_ARGS = a=3,my number=9",
          "Read ./program.txt and literally execute it as if you were an interpreted.",
        ].join("\n"),
        ctx: {
          cwd,
          model,
          modelRegistry,
        } as never,
        signal: undefined,
        depth: 1,
        progress: {
          status: "run",
          depth: 1,
          startedAt: Date.now(),
          step: "think",
        },
        onUpdate: undefined,
      });

      expect(result).toBe("27");
      expect(faux.state.callCount).toBe(1);
      expect(faux.getPendingResponseCount()).toBe(0);
    } finally {
      faux.unregister();
    }
  });
});
