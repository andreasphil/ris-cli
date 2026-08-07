import { describe, expect, it } from "vitest";
import {
  EliParseError,
  expressionPath,
  formatEli,
  isEliLike,
  manifestationDatePath,
  manifestationPath,
  normalizeEliInput,
  parseEli,
  workPath,
} from "./eli.ts";

const WORK = "bund/bgbl-1/1979/s1325";
const EXPRESSION = `${WORK}/2020-06-19/2/deu`;
const MANIFESTATION = `${EXPRESSION}/2020-06-19/regelungstext-1`;

describe("eli", () => {
  describe("normalizeEliInput", () => {
    it("strips an eli/ prefix", () => {
      expect(normalizeEliInput(`eli/${EXPRESSION}`)).toBe(EXPRESSION);
    });

    it("strips an API path prefix", () => {
      expect(normalizeEliInput(`/v1/legislation/eli/${EXPRESSION}`)).toBe(EXPRESSION);
    });

    it("strips a portal path prefix", () => {
      expect(normalizeEliInput(`/gesetze/eli/${EXPRESSION}`)).toBe(EXPRESSION);
    });

    it("extracts the path from an absolute URL", () => {
      expect(
        normalizeEliInput(`https://example.org/v1/legislation/eli/${MANIFESTATION}.html`),
      ).toBe(MANIFESTATION);
    });

    it("drops a known format extension", () => {
      expect(normalizeEliInput(`${MANIFESTATION}.xml`)).toBe(MANIFESTATION);
      expect(normalizeEliInput(`${EXPRESSION}/2020-06-19.zip`)).toBe(`${EXPRESSION}/2020-06-19`);
    });

    it("keeps a subtype that merely contains a hyphen and digits", () => {
      expect(normalizeEliInput(MANIFESTATION)).toBe(MANIFESTATION);
    });

    it("leaves an unknown extension alone, so resource names survive", () => {
      expect(normalizeEliInput(`${EXPRESSION}/2020-06-19/image.png`)).toBe(
        `${EXPRESSION}/2020-06-19/image.png`,
      );
    });

    it("tolerates surrounding whitespace and slashes", () => {
      expect(normalizeEliInput(`  /${EXPRESSION}/  `)).toBe(EXPRESSION);
    });
  });

  describe("parseEli", () => {
    it("detects the four addressing levels by segment count", () => {
      expect(parseEli(WORK).level).toBe("work");
      expect(parseEli(EXPRESSION).level).toBe("expression");
      expect(parseEli(`${EXPRESSION}/2020-06-19`).level).toBe("manifestation-date");
      expect(parseEli(MANIFESTATION).level).toBe("manifestation");
    });

    it("assigns every segment to the right field", () => {
      expect(parseEli(MANIFESTATION)).toEqual({
        level: "manifestation",
        jurisdiction: "bund",
        agent: "bgbl-1",
        year: "1979",
        naturalIdentifier: "s1325",
        pointInTime: "2020-06-19",
        version: "2",
        language: "deu",
        pointInTimeManifestation: "2020-06-19",
        subtype: "regelungstext-1",
      });
    });

    it("rejects a segment count that matches no level", () => {
      expect(() => parseEli("bund/bgbl-1/1979")).toThrow(EliParseError);
      expect(() => parseEli(`${WORK}/2020-06-19`)).toThrow(/5/);
    });

    it("rejects a point in time that is not a date", () => {
      expect(() => parseEli(`${WORK}/not-a-date/2/deu`)).toThrow(/YYYY-MM-DD/);
    });
  });

  describe("isEliLike", () => {
    it("accepts every addressing level", () => {
      for (const input of [WORK, EXPRESSION, MANIFESTATION, `eli/${EXPRESSION}`]) {
        expect(isEliLike(input)).toBe(true);
      }
    });

    it("rejects an abbreviation, so it can be looked up instead", () => {
      for (const input of ["BGB", "GG", "StVO", ""]) {
        expect(isEliLike(input)).toBe(false);
      }
    });
  });

  describe("path builders", () => {
    it("builds each level's path", () => {
      const eli = parseEli(MANIFESTATION);
      expect(workPath(eli)).toBe(WORK);
      expect(expressionPath(eli)).toBe(EXPRESSION);
      expect(manifestationDatePath(eli)).toBe(`${EXPRESSION}/2020-06-19`);
      expect(manifestationPath(eli)).toBe(MANIFESTATION);
    });

    it("refuses to build an expression path from a work ELI", () => {
      expect(() => expressionPath(parseEli(WORK))).toThrow(/missing date/);
    });

    it("refuses to build a manifestation path without a subtype", () => {
      expect(() => manifestationPath(parseEli(`${EXPRESSION}/2020-06-19`))).toThrow(/subtype/);
    });

    it("round-trips through formatEli", () => {
      for (const input of [WORK, EXPRESSION, `${EXPRESSION}/2020-06-19`, MANIFESTATION]) {
        expect(formatEli(parseEli(input))).toBe(`eli/${input}`);
      }
    });
  });
});
