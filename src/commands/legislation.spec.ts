import { describe, expect, it } from "vitest";
import type { components } from "../types/api.d.ts";
import { parseEli } from "../eli.ts";
import { articleRevision, findPart } from "./legislation.ts";

type Part = components["schemas"]["LegislationExpressionPartSchema"];

const ELI = parseEli("eli/bund/bgbl-1/1979/s1325/2020-06-19/1/deu");

function part(eId: string, extra: Partial<Part> = {}): Part {
  return { "@id": `#${eId}`, eId, name: eId, ...extra } as Part;
}

const PARTS: Part[] = [
  part("hauptteil-1_abschnitt-1", {
    hasPart: [part("art-z1", { revision: "REV-1" }), part("art-z2", { revision: null as never })],
  }),
  part("art-z3"),
];

describe("findPart", () => {
  it("finds a nested part", () => {
    expect(findPart(PARTS, "art-z1")?.revision).toBe("REV-1");
  });

  it("returns undefined for an unknown eId", () => {
    expect(findPart(PARTS, "art-z99")).toBeUndefined();
  });
});

describe("articleRevision", () => {
  it("returns the revision", () => {
    expect(articleRevision(PARTS, "art-z1", ELI)).toBe("REV-1");
  });

  it("points to toc for an unknown eId", () => {
    expect(() => articleRevision(PARTS, "art-z99", ELI)).toThrow(/ris legislation toc/);
  });

  it.each(["art-z2", "art-z3"])("explains a null or missing revision (%s)", (eId) => {
    expect(() => articleRevision(PARTS, eId, ELI)).toThrow(/has no revision/);
  });
});
