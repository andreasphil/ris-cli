import { describe, expect, it } from "vitest";
import {
  COLUMNS,
  columnsFor,
  isHydraCollection,
  paginationFooter,
  renderDetail,
  TRANSLATION_COLUMNS,
  renderTable,
  resolveFormat,
  unwrapMembers,
  type HydraCollection,
} from "./output.ts";

const COLLECTION: HydraCollection = {
  "@id": "/v1/case-law?pageIndex=0",
  "@type": "hydra:Collection",
  totalItems: 4312,
  member: [
    {
      "@type": "SearchResult",
      item: { "@type": "CaseLaw", documentNumber: "STRE1", courtName: "BGH Karlsruhe" },
      textMatches: [],
    },
    {
      "@type": "SearchResult",
      item: { "@type": "CaseLaw", documentNumber: "STRE2", courtName: "FG Münster" },
      textMatches: [],
    },
  ],
  view: { first: "/v1/case-law?pageIndex=0", next: "/v1/case-law?pageIndex=1" },
};

describe("output", () => {
  describe("isHydraCollection", () => {
    it("recognises a collection", () => {
      expect(isHydraCollection(COLLECTION)).toBe(true);
    });

    it("rejects a single document, an array and nullish values", () => {
      expect(isHydraCollection({ documentNumber: "STRE1" })).toBe(false);
      expect(isHydraCollection([])).toBe(false);
      expect(isHydraCollection(null)).toBe(false);
      expect(isHydraCollection(undefined)).toBe(false);
    });

    it("rejects a collection without totalItems", () => {
      expect(isHydraCollection({ member: [] })).toBe(false);
    });
  });

  describe("unwrapMembers", () => {
    it("lifts documents out of member[].item", () => {
      expect(
        unwrapMembers(COLLECTION).map(
          (item) => (item as { documentNumber: string }).documentNumber,
        ),
      ).toEqual(["STRE1", "STRE2"]);
    });

    it("passes through members that are already bare documents", () => {
      const collection: HydraCollection = { totalItems: 1, member: [{ documentNumber: "X" }] };
      expect(unwrapMembers(collection)).toEqual([{ documentNumber: "X" }]);
    });

    it("returns an empty array for an empty result set", () => {
      expect(unwrapMembers({ totalItems: 0, member: [] })).toEqual([]);
    });
  });

  describe("resolveFormat", () => {
    it("defaults to a table on a TTY and JSON when piped", () => {
      expect(resolveFormat(undefined, true)).toBe("table");
      expect(resolveFormat(undefined, false)).toBe("json");
    });

    it("honours an explicit format regardless of the TTY", () => {
      expect(resolveFormat("json", true)).toBe("json");
      expect(resolveFormat("table", false)).toBe("table");
    });

    it("rejects the formats that were removed", () => {
      expect(() => resolveFormat("ndjson", true)).toThrow(/Unknown output format/);
      expect(() => resolveFormat("raw", true)).toThrow(/Unknown output format/);
    });

    it("rejects an unknown format", () => {
      expect(() => resolveFormat("yaml", true)).toThrow(/Unknown output format/);
    });
  });

  describe("columnsFor", () => {
    it("picks kind-specific columns when every row is the same kind", () => {
      expect(columnsFor([{ "@type": "CaseLaw" }, { "@type": "CaseLaw" }])).toBe(COLUMNS.CaseLaw);
    });

    // The API emits "Decision" for case law, not "CaseLaw".
    it.each(["Decision", "Legislation", "Literature", "AdministrativeDirective"])(
      "recognises the %s discriminator the API actually sends",
      (kind) => {
        expect(columnsFor([{ "@type": kind }])).toBe(COLUMNS[kind]);
        expect(columnsFor([{ "@type": kind }])[0]!.header).not.toBe("kind");
      },
    );

    it("falls back to mixed columns for a heterogeneous result set", () => {
      const columns = columnsFor([{ "@type": "Decision" }, { "@type": "Legislation" }]);
      expect(columns).not.toBe(COLUMNS.Decision);
      expect(columns[0]!.header).toBe("kind");
    });

    it("falls back to mixed columns for an unknown kind", () => {
      expect(columnsFor([{ "@type": "SomethingNew" }])[0]!.header).toBe("kind");
    });
  });

  describe("renderTable", () => {
    it("renders a header and one line per row", () => {
      const table = renderTable(
        unwrapMembers(COLLECTION) as Record<string, unknown>[],
        COLUMNS.CaseLaw!,
        200,
      );
      const lines = table.split("\n");
      expect(lines[0]).toContain("DOCUMENT NUMBER");
      expect(lines).toHaveLength(3);
      expect(lines[1]).toContain("STRE1");
      expect(lines[2]).toContain("FG Münster");
    });

    it("says so when there is nothing to show", () => {
      expect(renderTable([], COLUMNS.CaseLaw!)).toBe("No results.");
    });

    it("joins array values", () => {
      const table = renderTable(
        [{ authors: ["Meier", "Schmidt"] }],
        [{ header: "authors", get: "authors" }],
      );
      expect(table).toContain("Meier, Schmidt");
    });

    it("collapses newlines so a row never breaks the layout", () => {
      const table = renderTable([{ headline: "a\n\nb" }], [{ header: "title", get: "headline" }]);
      expect(table.split("\n")).toHaveLength(2);
      expect(table).toContain("a b");
    });

    it("truncates to the terminal width", () => {
      const table = renderTable(
        [{ headline: "x".repeat(500) }],
        [{ header: "title", get: "headline" }],
        40,
      );
      for (const line of table.split("\n")) expect(line.length).toBeLessThanOrEqual(40);
      expect(table).toContain("…");
    });

    it("renders empty cells for missing fields", () => {
      expect(() => renderTable([{}], COLUMNS.CaseLaw!, 120)).not.toThrow();
    });
  });

  describe("TRANSLATION_COLUMNS", () => {
    // The backend maps `id` → `@id` and `filename` → `ris:filename` via
    // @JsonProperty, so reading the obvious names would render blank cells.
    const row = {
      "@type": "Legislation",
      "@id": "GG",
      name: "Basic Law",
      "ris:filename": "basic_law.html",
      translator: "Prof. Tomuschat",
    };

    it("reads the JSON-LD keys the backend actually emits", () => {
      const table = renderTable([row], TRANSLATION_COLUMNS, 200);
      expect(table).toContain("GG");
      expect(table).toContain("basic_law.html");
      expect(table).toContain("Basic Law");
    });

    it("would render blank cells if the plain names were used", () => {
      // Guards the mistake this replaced: `get: "id"` / `get: "filename"`.
      const table = renderTable(
        [row],
        [
          { header: "id", get: "id" },
          { header: "filename", get: "filename" },
        ],
        200,
      );
      expect(table).not.toContain("GG");
      expect(table).not.toContain("basic_law.html");
    });
  });

  describe("renderDetail", () => {
    it("lists fields, hiding JSON-LD keys and empty values", () => {
      const detail = renderDetail({
        "@type": "CaseLaw",
        documentNumber: "STRE1",
        ecli: "",
        keywords: [],
        courtName: "BGH",
      });
      expect(detail).toContain("documentNumber");
      expect(detail).toContain("courtName");
      expect(detail).not.toContain("@type");
      expect(detail).not.toContain("ecli");
      expect(detail).not.toContain("keywords");
    });
  });

  describe("paginationFooter", () => {
    it("reports the page size, total and how to get the next page", () => {
      expect(paginationFooter(COLLECTION, 0)).toBe("Showing 2 of 4,312 · next: --page 1");
    });

    it("omits the hint on the last page", () => {
      expect(paginationFooter({ ...COLLECTION, view: {} }, 3)).toBe("Showing 2 of 4,312");
    });

    it("reports an empty result set", () => {
      expect(paginationFooter({ totalItems: 0, member: [] }, 0)).toBe("No results.");
    });
  });
});
