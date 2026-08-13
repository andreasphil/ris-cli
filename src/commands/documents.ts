import { defineCommand } from "citty";
import type { components } from "../types/api.d.ts";
import {
  createContext,
  globalArgs,
  paginationArgs,
  printCollection,
  printDocument,
  searchArgs,
  searchQuery,
  writeData,
  writeNote,
} from "../shared.ts";

type StatisticsApiSchema = components["schemas"]["StatisticsApiSchema"];
type ZipDataCatalogSchema = components["schemas"]["ZipDataCatalogSchema"];

export const searchCommand = defineCommand({
  meta: {
    name: "search",
    description:
      "Search across every document kind (case law, legislation, literature, directives)",
  },
  args: {
    terms: {
      type: "positional",
      description: "Search terms; all tokens must appear in a matching document",
      required: false,
    },
    "most-relevant-on": {
      type: "string",
      description: "Return only the one most relevant legislation expression for this date",
      valueHint: "date",
    },
    ...searchArgs,
    ...globalArgs,
  },
  async run({ args }) {
    const ctx = await createContext(args);
    const terms = args._.join(" ").trim();
    await printCollection(ctx, "/v1/document", {
      ...searchQuery(args, terms || undefined),
      mostRelevantOn: asString(args["most-relevant-on"]),
    });
  },
});

export const luceneCommand = defineCommand({
  meta: {
    name: "lucene",
    description: "Search across every document kind using Lucene query syntax",
  },
  args: {
    query: {
      type: "positional",
      description: "Lucene query, e.g. 'courtName:\"BGH Karlsruhe\" AND date:[2020 TO 2024]'",
      required: true,
    },
    ...paginationArgs,
    ...globalArgs,
  },
  async run({ args }) {
    const ctx = await createContext(args);
    await printCollection(ctx, "/v1/document/lucene-search", {
      query: args.query,
      size: asString(args.size),
      pageIndex: asString(args.page),
      sort: asString(args.sort),
    });
  },
});

export const statsCommand = defineCommand({
  meta: { name: "stats", description: "Document counts per kind" },
  args: { ...globalArgs },
  async run({ args }) {
    const ctx = await createContext(args);
    const stats = await ctx.client.json<StatisticsApiSchema>({ path: "/v1/statistics" });

    if (ctx.format === "json") {
      printDocument(ctx, stats as unknown as Record<string, unknown>);
      return;
    }

    const rows = Object.entries(stats).map(
      ([kind, value]) => [kind, (value?.count ?? 0).toLocaleString("en-US")] as const,
    );
    const labelWidth = Math.max(...rows.map(([kind]) => kind.length));
    const countWidth = Math.max(...rows.map(([, count]) => count.length));
    const total = Object.values(stats).reduce((sum, value) => sum + (value?.count ?? 0), 0);
    writeData(
      rows
        .map(([kind, count]) => `${kind.padEnd(labelWidth)}  ${count.padStart(countWidth)}`)
        .join("\n"),
    );
    // The total is a summary, not a row of data — same split as a table's footer.
    writeNote(
      `${"".padEnd(labelWidth)}  ${"-".repeat(countWidth)}\n${"total".padEnd(labelWidth)}  ${total
        .toLocaleString("en-US")
        .padStart(countWidth)}`,
    );
  },
});

export const bulkLinksCommand = defineCommand({
  meta: {
    name: "bulk-links",
    description: "Download URLs for the bulk ZIP archives of each document kind",
  },
  args: { ...globalArgs },
  async run({ args }) {
    const ctx = await createContext(args);
    const catalog = await ctx.client.json<ZipDataCatalogSchema>({ path: "/v1/bulk-zip-links" });

    if (ctx.format === "json") {
      printDocument(ctx, catalog as unknown as Record<string, unknown>);
      return;
    }
    // The spec declares `contentUrl` as required, but the API returns null for a
    // kind that has no snapshot yet (verified against testphase: literature and
    // administrative-directives, both of which have zero documents there).
    const lines = (catalog.dataSet ?? []).map(
      (set) => `${set.name}\n  ${set.distribution?.contentUrl ?? "(no download URL)"}`,
    );
    writeData(lines.join("\n"));
  },
});

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
