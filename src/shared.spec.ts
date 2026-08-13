import { describe, expect, it, vi } from "vitest";
import { collectRepeated, list, printBinary, printText } from "./shared.ts";

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

  // There is no --output-file: the shell decides where output lands, so everything
  // has to reach stdout unmodified for `>` and `|` to work.
  describe("printText", () => {
    it("writes the body to stdout", () => {
      const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      try {
        printText("<html>hi</html>");
        expect(stdout).toHaveBeenCalledWith("<html>hi</html>\n");
      } finally {
        stdout.mockRestore();
      }
    });

    it("does not add a second trailing newline", () => {
      const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      try {
        printText("<html>hi</html>\n");
        expect(stdout).toHaveBeenCalledWith("<html>hi</html>\n");
      } finally {
        stdout.mockRestore();
      }
    });
  });

  describe("printBinary", () => {
    const BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

    function withTty<T>(isTty: boolean, run: () => T): T {
      const original = process.stdout.isTTY;
      // isTTY is undefined rather than false when stdout is not a terminal.
      Object.defineProperty(process.stdout, "isTTY", { value: isTty, configurable: true });
      try {
        return run();
      } finally {
        Object.defineProperty(process.stdout, "isTTY", {
          value: original,
          configurable: true,
        });
      }
    }

    it("writes raw bytes to stdout when redirected or piped", () => {
      withTty(false, () => {
        const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
        try {
          printBinary(BYTES);
          expect(stdout).toHaveBeenCalledWith(BYTES);
        } finally {
          stdout.mockRestore();
        }
      });
    });

    it("refuses to dump binary into a terminal, naming the fix", () => {
      withTty(true, () => {
        expect(() => printBinary(BYTES)).toThrow(/Refusing to write binary data/);
        expect(() => printBinary(BYTES)).toThrow(/> out\.zip/);
      });
    });
  });
});
