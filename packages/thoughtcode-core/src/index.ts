export const VIBE_CALL_TOOL_NAME = "VIBECALL";
export const VIBE_RETURN_TOOL_NAME = "VIBERETURN";

export interface VibeCallArgs {
  program_file_path: string;
  name: string;
  args: string;
}

export interface VibeReturnArgs {
  value: string;
}

export interface ThoughtcodeToolDescription {
  name: string;
  label: string;
  description: string;
  promptSnippet: string;
  promptGuidelines: string[];
}

export const VIBE_CALL_TOOL_DESCRIPTION: ThoughtcodeToolDescription = {
  name: VIBE_CALL_TOOL_NAME,
  label: "VIBECALL",
  description:
    "Executes a named Thoughtcode VIBEMETHOD from a program file. Returns the result as a string.",
  promptSnippet:
    "Use this tool at the point where ThoughtCode program instructs you to make a VIBECALL",
  promptGuidelines: [
  ],
};

export const VIBE_RETURN_TOOL_DESCRIPTION: ThoughtcodeToolDescription = {
  name: VIBE_RETURN_TOOL_NAME,
  label: "VIBERETURN",
  description:
    "Send a return value from inside of a VIBEMETHOD.",
  promptSnippet:
    "Use this tool at the point where ThoughtCode program instructs you to make a VIBERETURN",
  promptGuidelines: [
  ],
};

export const THOUGHTCODE_TOOL_DESCRIPTIONS = [
  VIBE_CALL_TOOL_DESCRIPTION,
  VIBE_RETURN_TOOL_DESCRIPTION,
] as const;

export function buildVibeCallSubagentPrompt(args: VibeCallArgs): string {
  return [
    `ENTRYPOINT = ${args.name}`,
    `ENTRYPOINT_ARGS = ${args.args}`,
    `Read ${args.program_file_path} and literally execute it as if you were an interpreter. Start executing \
    the program at the VIBEMETHOD, corresponding to the ENTRYPOINT, and use the ENTRYPOINT_ARGS as arguments for it.`,
  ].join("\n");
}
