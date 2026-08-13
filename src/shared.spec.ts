import { describe, expect, it } from "vitest";
import { collectRepeated, list } from "./shared.ts";

describe("shared", () => {
  // citty's parser keeps only the last occurrence of a repeated flag, so these
  // read the raw argv instead. Without this, `--type A --type B` loses A silently.
  describe("collectRepeated", () => {
    it("collects every occurrence of a repeated flag", () => {
      expect(collectRepeated(["--type", "A", "--type", "B"], "type")).toEqual(["A", "B"]);
    });

    it("supports the --flag=value form", () => {
      expect(collectRepeated(["--type=A", "--type=B"], "type")).toEqual(["A", "B"]);
    });

    it("mixes both forms", () => {
      expect(collectRepeated(["--type", "A", "--type=B"], "type")).toEqual(["A", "B"]);
    });

    it("ignores other flags and positionals", () => {
      expect(
        collectRepeated(["search", "--court", "BGH", "--type", "A", "--size", "5"], "type"),
      ).toEqual(["A"]);
    });

    it("returns nothing when the flag is absent", () => {
      expect(collectRepeated(["--size", "5"], "type")).toEqual([]);
    });

    it("does not swallow the next flag when a value is missing", () => {
      expect(collectRepeated(["--type", "--size", "5"], "type")).toEqual([]);
    });

    it("does not match a flag that merely shares a prefix", () => {
      expect(collectRepeated(["--type-group", "Urteil"], "type")).toEqual([]);
    });
  });

  describe("list", () => {
    it("splits comma-separated values", () => {
      expect(list(["--type", "Urteil,Beschluss"], "type")).toEqual(["Urteil", "Beschluss"]);
    });

    it("combines repetition and comma separation", () => {
      expect(list(["--type", "Urteil,Beschluss", "--type", "Entscheidung"], "type")).toEqual([
        "Urteil",
        "Beschluss",
        "Entscheidung",
      ]);
    });

    it("trims whitespace around values", () => {
      expect(list(["--type", "Urteil , Beschluss"], "type")).toEqual(["Urteil", "Beschluss"]);
    });

    it("returns undefined when absent, so the parameter is omitted entirely", () => {
      expect(list(["--size", "5"], "type")).toBeUndefined();
    });

    it("returns undefined for an empty value rather than sending a blank filter", () => {
      expect(list(["--type", ",, "], "type")).toBeUndefined();
    });
  });
});
