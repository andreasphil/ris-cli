import { defineCommand } from "citty";
import { beforeAll, describe, expect, it } from "vitest";
import { describeCommand, type CommandNode } from "./tree.ts";

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
            "type-group": { type: "string", description: "Type group", alias: "g" },
          },
        }),
      },
    }),
    internal: defineCommand({
      meta: { name: "internal", description: "hidden", hidden: true },
    }),
  },
});

describe("tree", () => {
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

    it("omits commands marked hidden, whatever they are named", () => {
      expect(tree.subCommands.map((child) => child.name)).not.toContain("internal");
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
});
