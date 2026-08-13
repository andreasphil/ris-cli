import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineCommand, runCommand } from "citty";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { skillCommand } from "./commands/skill.ts";
import { generateSkill, skillFilePath } from "./skill.ts";
import { describeCommand, type CommandNode } from "./tree.ts";

const FIXTURE = defineCommand({
  meta: { name: "ris", version: "9.9.9", description: "root" },
  subCommands: {
    stats: defineCommand({ meta: { name: "stats", description: "Document counts" } }),
    "case-law": defineCommand({
      meta: { name: "case-law", alias: ["cl"], description: "Court decisions" },
      subCommands: {
        search: defineCommand({
          meta: { name: "search", description: "Search decisions" },
          args: {
            terms: { type: "positional", description: "terms", required: false },
            court: { type: "string", description: "Court name" },
            "legal-effect": { type: "enum", options: ["JA", "NEIN"], description: "Rechtskraft" },
            profile: { type: "string", description: "Profile", alias: "p" },
            size: { type: "string", description: "Page size" },
            page: { type: "string", description: "Page index" },
            sort: { type: "string", description: "Sort field" },
            all: { type: "boolean", description: "Every page" },
            from: { type: "string", description: "From date" },
            to: { type: "string", description: "To date" },
          },
        }),
        resource: defineCommand({
          meta: { name: "resource", description: "An embedded file" },
          args: {
            documentNumber: { type: "positional", description: "Number", required: true },
            filename: { type: "positional", description: "File name", required: true },
          },
        }),
      },
    }),
    __hidden: defineCommand({ meta: { name: "__hidden", description: "hidden" } }),
  },
});

describe("skill", () => {
  let tree: CommandNode;
  let skill: string;

  beforeAll(async () => {
    tree = await describeCommand(FIXTURE, "ris");
    skill = generateSkill(tree, "9.9.9");
  });

  describe("generateSkill", () => {
    it("starts with frontmatter naming the skill", () => {
      expect(skill.startsWith("---\nname: ris-cli\ndescription:")).toBe(true);
      expect(skill).toMatch(/^---\n[\s\S]+?\n---\n/);
    });

    it("tells the agent not to switch the user's profile", () => {
      expect(skill).toContain("Never switch or edit the user's profile");
      expect(skill).toContain("ris config use");
      expect(skill).toContain("--profile <name>");
    });

    it("spells out full command paths with their positionals", () => {
      expect(skill).toContain("`ris case-law search [terms]`");
      expect(skill).toContain("`ris case-law resource <documentNumber> <filename>`");
      expect(skill).toContain("`ris stats` — Document counts");
    });

    it("groups subcommands under a heading carrying the alias", () => {
      expect(skill).toContain("### `ris case-law` (cl) — Court decisions");
    });

    it("names the shared search flags instead of repeating them per command", () => {
      const line = skill.split("\n").find((entry) => entry.startsWith("  Flags:"))!;
      expect(line).toContain("search flags");
      expect(line).not.toContain("--size");
      expect(skill).toContain("- `--size <value>` — Results per page");
    });

    it("renders enum options and short aliases of command-specific flags", () => {
      expect(skill).toContain("`--legal-effect=JA|NEIN`");
      expect(skill).toContain("`--output, -o=json|table|ndjson|raw`");
    });

    it("documents the global flags once, not per command", () => {
      expect(skill).toContain("- `--profile, -p <name>` — Named profile from the config file");
      expect(skill).not.toContain("`--profile, -p <name>`,");
    });

    it("omits hidden machine-facing commands", () => {
      expect(skill).not.toContain("__hidden");
    });

    it("records the version it was generated from", () => {
      expect(skill).toContain("Generated from ris 9.9.9");
    });
  });

  describe("install and update", () => {
    const command = skillCommand(() => FIXTURE);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    afterEach(() => stdout.mockClear());

    async function target(): Promise<string> {
      return join(await mkdtemp(join(tmpdir(), "ris-skill-")), ".claude", "skills");
    }

    it("writes SKILL.md under <target>/ris-cli", async () => {
      const directory = await target();
      await runCommand(command, { rawArgs: ["install", "--target", directory] });

      const written = await readFile(skillFilePath(directory), "utf8");
      expect(written).toContain("name: ris-cli");
      expect(stdout.mock.calls[0]![0]).toMatch(/^Installed skill "ris-cli" → \//);
    });

    it("refuses to overwrite an existing skill, pointing at update", async () => {
      const directory = await target();
      await runCommand(command, { rawArgs: ["install", "--target", directory] });

      await expect(
        runCommand(command, { rawArgs: ["install", "--target", directory] }),
      ).rejects.toThrow(/already exists\. Run "ris skill update" to overwrite it/);
    });

    it("update overwrites what install wrote", async () => {
      const directory = await target();
      const path = skillFilePath(directory);
      await runCommand(command, { rawArgs: ["install", "--target", directory] });
      await writeFile(path, "stale\n", "utf8");

      await runCommand(command, { rawArgs: ["update", "--target", directory] });
      expect(await readFile(path, "utf8")).toContain("name: ris-cli");
      expect(stdout.mock.calls.at(-1)![0]).toMatch(/^Updated skill "ris-cli" → \//);
    });
  });
});
