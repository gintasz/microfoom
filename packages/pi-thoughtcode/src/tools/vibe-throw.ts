import { defineTool, type AgentToolResult } from "@earendil-works/pi-coding-agent";
import { VIBE_THROW_TOOL_DESCRIPTION, VibeThrowError, type VibeThrowArgs } from "thoughtcode-core";
import { textResult } from "../shared/tool-result.js";
import type { ThoughtcodeToolOptions, VibeThrowDetails } from "../types.js";
import { vibeThrowParameters, type VibeThrowParams } from "./schema.js";

export { VibeThrowError };

export function createVibeThrowTool(options: ThoughtcodeToolOptions = {}) {
  return defineTool({
    ...VIBE_THROW_TOOL_DESCRIPTION,
    parameters: vibeThrowParameters,
    async execute(_toolCallId, params: VibeThrowParams): Promise<AgentToolResult<VibeThrowDetails>> {
      const args: VibeThrowArgs = { message: params.message };

      // Record the throw and terminate the turn. The subagent runner turns this into a VibeThrowError
      // that surfaces at the VIBECALL boundary; the tool itself does not throw (that would be a tool
      // error, not a clean termination).
      if (options.onVibeThrow) {
        options.onVibeThrow(args.message);
      }

      return textResult(args.message, { kind: "vibethrow", message: args.message }, true);
    },
  });
}

export const vibeThrowTool = createVibeThrowTool();
