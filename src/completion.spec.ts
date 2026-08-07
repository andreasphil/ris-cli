import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { defineCommand } from "citty";
import { beforeAll, describe, expect, it } from "vitest";
import {
  SHELLS,
  describeCommand,
  generate,
  generateBash,
  generateFish,
  generateZsh,
  type CommandNode,
} from "./completion.ts";

const execFileAsync = promisify(execFile);

const FIXTURE = defineCommand({
  meta: { name: "ris", description: "root" },
  subCommands: {
    "case-law": defineCommand({
      meta: { name: "case-law", alias: ["cl"], description: "Court decisions" },
      subCommands: {
        search: defineCommand({
          meta: { name: "search", description: "Search decisions" },
          args: {
            terms: { type: "positional", description: "terms", required: false },
            court: { type: "string", description: "Court name" },
            "legal-effect": {
              type: "enum",
              options: ["JA", "NEIN"],
              description: "Rechtskraft",
            },
            profile: { type: "string", description: "Profile", alias: "p" },
            verbose: { type: "boolean", description: "Log requests", alias: "v" },
            "output-file": { type: "string", description: "Write to file", alias: "O" },
          },
        }),
      },
    }),
    __profiles: defineCommand({
      meta: { name: "__profiles", description: "hidden", hidden: true },
    }),
  },
});

describe("completion", () => {
  let tree: CommandNode;

  beforeAll(async () => {
    tree = await describeCommand(FIXTURE, "ris");
  });

  describe("describeCommand", () => {
    it("records subcommands and their aliases", () => {
      const caseLaw = tree.subCommands.find((child) => child.name === "case-law");
      expect(caseLaw?.aliases).toEqual(["cl"]);
      expect(caseLaw?.subCommands.map((child) => child.name)).toEqual(["search"]);
    });

    it("omits hidden machine-facing commands", () => {
      expect(tree.subCommands.map((child) => child.name)).not.toContain("__profiles");
    });

    it("separates flags from positionals", () => {
      const search = tree.subCommands[0]!.subCommands[0]!;
      const names = search.flags.map((flag) => flag.name);
      expect(names).toContain("court");
      expect(names).not.toContain("terms");
    });

    it("captures short aliases, enum options and whether a flag takes a value", () => {
      const search = tree.subCommands[0]!.subCommands[0]!;
      const byName = new Map(search.flags.map((flag) => [flag.name, flag]));
      expect(byName.get("profile")!.shortAliases).toEqual(["p"]);
      expect(byName.get("legal-effect")!.options).toEqual(["JA", "NEIN"]);
      expect(byName.get("verbose")!.takesValue).toBe(false);
      expect(byName.get("court")!.takesValue).toBe(true);
    });
  });

  describe("generated scripts", () => {
    it.each([...SHELLS])("%s mentions commands and aliases", (shell) => {
      const script = generate(shell, tree);
      expect(script).toContain("case-law");
      expect(script).toContain("cl");
    });

    // fish declares flags as `-l court`, the others as `--court`.
    it.each([
      ["bash", "--court", "--legal-effect"],
      ["zsh", "--court", "--legal-effect"],
      ["fish", "-l court", "-l legal-effect"],
    ] as const)("%s declares each flag", (shell, ...expected) => {
      const script = generate(shell, tree);
      for (const token of expected) expect(script).toContain(token);
    });

    it.each([...SHELLS])("%s never offers a hidden command as a candidate", (shell) => {
      const script = generate(shell, tree);
      // It may legitimately *call* `ris __profiles`; it must never suggest it.
      expect(script).not.toMatch(/-a\s+__profiles/);
      expect(script).not.toMatch(/echo '[^']*__profiles/);
    });

    it("wires --profile to the hidden profile lister", () => {
      expect(generateBash(tree)).toContain("__profiles");
      expect(generateZsh(tree)).toContain("__profiles");
      expect(generateFish(tree)).toContain("__profiles");
    });

    it("matches a flag's short alias as well as its long form", () => {
      // Without this, `-p <TAB>` would fall through to command completion.
      expect(generateBash(tree)).toContain("--profile|-p)");
      expect(generateZsh(tree)).toContain("--profile|-p)");
    });

    it("offers enum values for the flags that have them", () => {
      expect(generateBash(tree)).toContain("JA NEIN");
      expect(generateFish(tree)).toContain("JA NEIN");
    });

    it("routes path-valued flags to filename completion", () => {
      expect(generateBash(tree)).toContain("--output-file|-O)");
      expect(generateFish(tree)).toContain("-F");
    });

    it("emits a zsh compdef header and a bash complete registration", () => {
      expect(generateZsh(tree).startsWith("#compdef ris")).toBe(true);
      expect(generateBash(tree)).toContain("complete -F _ris ris");
    });

    it("quotes descriptions so an apostrophe cannot break the script", async () => {
      const risky = await describeCommand(
        defineCommand({
          meta: { name: "ris" },
          subCommands: {
            odd: defineCommand({ meta: { name: "odd", description: "it's tricky" } }),
          },
        }),
        "ris",
      );
      // Only zsh and fish render descriptions; bash completion emits names only.
      for (const shell of ["zsh", "fish"] as const) {
        expect(generate(shell, risky)).toContain(`it'\\''s tricky`);
      }
    });
  });

  // The scripts are only useful if the shell can actually parse them. zsh ships
  // with macOS and Linux CI images; bash and fish may not, so those are skipped
  // when absent rather than failing the suite.
  describe("shell syntax", () => {
    let directory: string;

    beforeAll(async () => {
      directory = await mkdtemp(join(tmpdir(), "ris-completion-"));
    });

    async function checkable(binary: string): Promise<boolean> {
      try {
        await execFileAsync("command", ["-v", binary], { shell: "/bin/sh" });
        return true;
      } catch {
        return false;
      }
    }

    it.each([
      ["bash", "bash", ["-n"]],
      ["zsh", "zsh", ["-n"]],
      ["fish", "fish", ["--no-execute"]],
    ] as const)("%s parses the generated script", async (shell, binary, flags) => {
      if (!(await checkable(binary))) {
        expect(true).toBe(true);
        return;
      }
      const file = join(directory, `ris.${shell}`);
      await writeFile(file, generate(shell, tree));
      await expect(execFileAsync(binary, [...flags, file])).resolves.toBeDefined();
    });
  });
});
