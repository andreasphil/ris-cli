import { defineCommand, type CommandDef } from "citty";
import { SHELLS, describeCommand, generate, type Shell } from "../completion.ts";
import { knownProfileNames, loadConfig } from "../config.ts";

/**
 * Takes the root command as a thunk: the root imports this module, so reading it
 * at definition time would be a circular import.
 */
export function completionCommand(getRoot: () => CommandDef) {
  return defineCommand({
    meta: {
      name: "completion",
      description: `Print a shell completion script (${SHELLS.join(", ")})`,
    },
    args: {
      // citty positionals cannot carry `options`, so the value is validated below.
      shell: {
        type: "positional",
        description: `Which shell to generate for: ${SHELLS.join(", ")}`,
        required: true,
      },
    },
    async run({ args }) {
      const shell = args.shell as Shell;
      if (!SHELLS.includes(shell)) {
        throw new Error(`Unsupported shell "${shell}". Choose one of: ${SHELLS.join(", ")}.`);
      }
      process.stdout.write(generate(shell, await describeCommand(getRoot(), "ris")));
    },
  });
}

/** Feeds `--profile` completion. Hidden: it is machine-facing, not a user command. */
export const profileNamesCommand = defineCommand({
  meta: { name: "__profiles", description: "List profile names", hidden: true },
  async run() {
    const config = await loadConfig();
    process.stdout.write(`${knownProfileNames(config).join("\n")}\n`);
  },
});
