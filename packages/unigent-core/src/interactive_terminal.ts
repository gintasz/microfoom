import process from "node:process";
import { createInterface, type Interface } from "node:readline";
import { AgentInputError } from "./errors.js";

interface InteractivePrompt {
  readonly ask: (prompt: string) => Promise<string>;
  readonly write: (message: string) => void;
  readonly close: () => void;
}

class InteractiveInputCancelledError extends Error {
  public constructor(message = "interactive input cancelled", options?: ErrorOptions) {
    super(message, options);
    this.name = "InteractiveInputCancelledError";
  }
}

function createTerminalPrompt(): InteractivePrompt {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new AgentInputError(
      "-i requires an interactive terminal; it is unavailable in TUI and piped execution",
    );
  }
  const reader: Interface = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true,
  });
  let closed = false;
  reader.once("SIGINT", () => {
    reader.close();
  });
  reader.once("close", () => {
    closed = true;
  });
  return {
    ask: async (prompt: string): Promise<string> => {
      if (closed) {
        throw new InteractiveInputCancelledError();
      }
      return await new Promise<string>((resolveAnswer, reject) => {
        let settled = false;
        const cancel = (): void => {
          if (!settled) {
            settled = true;
            reject(new InteractiveInputCancelledError());
          }
        };
        reader.once("close", cancel);
        reader.question(prompt, (answer) => {
          if (!settled) {
            settled = true;
            reader.removeListener("close", cancel);
            resolveAnswer(answer);
          }
        });
      });
    },
    write: (message: string): void => {
      process.stderr.write(message);
    },
    close: (): void => {
      reader.close();
    },
  };
}

export type { InteractivePrompt };
export { createTerminalPrompt, InteractiveInputCancelledError };
