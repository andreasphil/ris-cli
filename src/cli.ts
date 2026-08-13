import { defineCommand, runCommand, showUsage, type CommandDef } from "citty";
import { ApiError, DryRunComplete } from "./client.ts";
import { caseLawCommand } from "./commands/caseLaw.ts";
import { configCommand } from "./commands/config.ts";
import { directiveCommand } from "./commands/directive.ts";
import {
  bulkLinksCommand,
  luceneCommand,
  rawCommand,
  searchCommand,
  statsCommand,
} from "./commands/documents.ts";
import { legislationCommand } from "./commands/legislation.ts";
import { literatureCommand } from "./commands/literature.ts";
import { skillCommand } from "./commands/skill.ts";
import { VERSION } from "./version.ts";

// Explicitly typed: `skill` receives the root, so the initializer references
// `main` and inference would be circular.
const main: CommandDef = defineCommand({
  meta: {
    name: "ris",
    version: VERSION,
    description:
      "Query the RIS API: German federal legislation, court decisions, literature and " +
      "administrative directives.",
  },
  subCommands: {
    search: searchCommand,
    lucene: luceneCommand,
    "case-law": caseLawCommand,
    legislation: legislationCommand,
    literature: literatureCommand,
    directive: directiveCommand,
    stats: statsCommand,
    "bulk-links": bulkLinksCommand,
    raw: rawCommand,
    config: configCommand,
    skill: skillCommand(() => main),
  },
});

async function resolveValue<T>(value: T | (() => T | Promise<T>)): Promise<T> {
  return typeof value === "function" ? (value as () => Promise<T>)() : value;
}

async function findSubCommand(
  subCommands: Record<string, unknown>,
  name: string,
): Promise<CommandDef | undefined> {
  const direct = subCommands[name];
  if (direct) return resolveValue(direct as CommandDef);

  for (const candidate of Object.values(subCommands)) {
    const command = await resolveValue(candidate as CommandDef);
    const meta = await resolveValue(command.meta);
    const alias = meta?.alias;
    const aliases = alias === undefined ? [] : Array.isArray(alias) ? alias : [alias];
    if (aliases.includes(name)) return command;
  }
  return undefined;
}

/**
 * Walks down to the command the user actually asked about, so `--help` on a
 * subcommand shows that subcommand's usage. citty does this internally for
 * `runMain`, but `runMain` also swallows every error into a raw stack trace, so we
 * drive `runCommand` ourselves and reimplement just this part.
 */
async function resolveForUsage(
  command: CommandDef,
  rawArgs: string[],
  parent?: CommandDef,
): Promise<[CommandDef, CommandDef | undefined]> {
  const subCommands = await resolveValue(command.subCommands);
  if (subCommands && Object.keys(subCommands).length > 0) {
    const index = rawArgs.findIndex((arg) => !arg.startsWith("-"));
    const name = index === -1 ? undefined : rawArgs[index];
    if (name) {
      const subCommand = await findSubCommand(subCommands as Record<string, unknown>, name);
      if (subCommand) return resolveForUsage(subCommand, rawArgs.slice(index + 1), command);
    }
  }
  return [command, parent];
}

export async function run(argv: string[] = process.argv.slice(2)): Promise<void> {
  try {
    if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
      const [command, parent] = await resolveForUsage(main, argv);
      await showUsage(command, parent);
      return;
    }
    // Only the long form: -v is taken by --verbose.
    if (argv.length === 1 && argv[0] === "--version") {
      process.stdout.write(`${VERSION}\n`);
      return;
    }

    await runCommand(main, { rawArgs: argv });
  } catch (error) {
    // --dry-run unwinds through here once the request has been printed.
    if (error instanceof DryRunComplete) return;

    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`ris: ${message}\n`);

    if (isUnknownCommand(error)) {
      const [command, parent] = await resolveForUsage(main, argv);
      await showUsage(command, parent);
    }

    // 2 distinguishes "the API said no" from "the CLI could not run".
    process.exitCode = error instanceof ApiError ? 2 : 1;
  }
}

function isUnknownCommand(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === "E_UNKNOWN_COMMAND" || code === "E_NO_COMMAND";
}
