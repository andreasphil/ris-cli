import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { defineCommand, type ArgsDef, type CommandDef } from "citty";
import { DEFAULT_SKILL_DIR, generateSkill, SKILL_NAME, skillFilePath } from "../skill.ts";
import { describeCommand } from "../tree.ts";
import { VERSION } from "../version.ts";

const targetArgs = {
  target: {
    type: "string",
    description: `Skills directory to install into (default: ${DEFAULT_SKILL_DIR})`,
    valueHint: "dir",
  },
} as const satisfies ArgsDef;

async function write(
  getRoot: () => CommandDef,
  target: unknown,
  overwrite: boolean,
): Promise<void> {
  const directory = typeof target === "string" && target !== "" ? target : DEFAULT_SKILL_DIR;
  const path = resolve(skillFilePath(directory));
  const content = generateSkill(await describeCommand(getRoot(), "ris"), VERSION);

  await mkdir(dirname(path), { recursive: true });
  try {
    // "wx" fails if the file exists, so the check cannot race with the write.
    await writeFile(path, content, { encoding: "utf8", flag: overwrite ? "w" : "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `${path} already exists. Run "ris skill update" to overwrite it, ` +
          `or install elsewhere with --target <dir>.`,
      );
    }
    throw error;
  }

  process.stdout.write(`${overwrite ? "Updated" : "Installed"} skill "${SKILL_NAME}" → ${path}\n`);
}

/**
 * Takes the root command as a thunk: the root imports this module, so reading it
 * at definition time would be a circular import.
 */
export function skillCommand(getRoot: () => CommandDef) {
  return defineCommand({
    meta: {
      name: "skill",
      description: "Install this CLI's usage guide as an agent skill (Claude Code and friends)",
    },
    subCommands: {
      install: defineCommand({
        meta: {
          name: "install",
          description: `Write ${SKILL_NAME}/SKILL.md, failing if it already exists`,
        },
        args: { ...targetArgs },
        async run({ args }) {
          await write(getRoot, args.target, false);
        },
      }),
      update: defineCommand({
        meta: {
          name: "update",
          description: `Regenerate ${SKILL_NAME}/SKILL.md, overwriting an existing one`,
        },
        args: { ...targetArgs },
        async run({ args }) {
          await write(getRoot, args.target, true);
        },
      }),
    },
  });
}
