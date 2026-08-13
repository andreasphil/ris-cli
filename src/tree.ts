/**
 * Command tree introspection.
 *
 * Walks the citty definitions into a plain description of commands, flags and
 * positionals, so generated documentation cannot drift from the CLI itself.
 */
import type { ArgsDef, CommandDef } from "citty";

export interface FlagSpec {
  /** Long form without dashes, e.g. `dry-run`. */
  name: string;
  shortAliases: string[];
  description: string;
  takesValue: boolean;
  options?: string[];
  valueHint?: string;
}

export interface PositionalSpec {
  name: string;
  description: string;
  required: boolean;
}

export interface CommandNode {
  name: string;
  aliases: string[];
  description: string;
  subCommands: CommandNode[];
  flags: FlagSpec[];
  positionals: PositionalSpec[];
}

async function resolve<T>(value: T | (() => T | Promise<T>) | undefined): Promise<T | undefined> {
  return typeof value === "function" ? (value as () => Promise<T>)() : value;
}

function toArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Splits an args definition into flags and positionals. Flags are sorted by name;
 * positionals keep their declaration order, which is the order they are passed in.
 */
export function describeArgs(args: ArgsDef): {
  flags: FlagSpec[];
  positionals: PositionalSpec[];
} {
  const flags: FlagSpec[] = [];
  const positionals: PositionalSpec[] = [];

  for (const [name, definition] of Object.entries(args)) {
    if (definition.type === "positional") {
      positionals.push({
        name,
        description: definition.description ?? "",
        required: (definition as { required?: boolean }).required !== false,
      });
      continue;
    }
    flags.push({
      name,
      shortAliases: toArray((definition as { alias?: string | string[] }).alias),
      description: definition.description ?? "",
      takesValue: definition.type !== "boolean",
      options: (definition as { options?: string[] }).options,
      valueHint: (definition as { valueHint?: string }).valueHint,
    });
  }

  return { flags: flags.sort((a, b) => a.name.localeCompare(b.name)), positionals };
}

/** Walks a citty command definition into a shell-agnostic description. */
export async function describeCommand(
  command: CommandDef,
  fallbackName = "",
): Promise<CommandNode> {
  const meta = await resolve(command.meta);
  const args = ((await resolve(command.args)) ?? {}) as ArgsDef;
  const { flags, positionals } = describeArgs(args);

  const subCommands: CommandNode[] = [];
  const subDefs = ((await resolve(command.subCommands)) ?? {}) as Record<string, CommandDef>;
  for (const [name, subDef] of Object.entries(subDefs)) {
    const resolved = await resolve<CommandDef>(subDef as CommandDef);
    if (!resolved) continue;
    const child = await describeCommand(resolved, name);
    // Machine-facing commands are named with a __ prefix and stay undocumented.
    if (child.name.startsWith("__")) continue;
    subCommands.push({ ...child, name });
  }

  return {
    name: meta?.name ?? fallbackName,
    aliases: toArray(meta?.alias),
    description: meta?.description ?? "",
    subCommands,
    flags,
    positionals,
  };
}
