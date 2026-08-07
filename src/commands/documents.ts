import { defineCommand } from "citty";
import type { components } from "../types/api.d.ts";
import {
  collectRepeated,
  createContext,
  globalArgs,
  paginationArgs,
  printCollection,
  printDocument,
  searchArgs,
  searchQuery,
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

    if (ctx.queryPath || ctx.format !== "table") {
      printDocument(ctx, stats as unknown as Record<string, unknown>);
      return;
    }

    const rows = Object.entries(stats).map(
      ([kind, value]) => [kind, (value?.count ?? 0).toLocaleString("en-US")] as const,
    );
    const labelWidth = Math.max(...rows.map(([kind]) => kind.length));
    const countWidth = Math.max(...rows.map(([, count]) => count.length));
    const total = Object.values(stats).reduce((sum, value) => sum + (value?.count ?? 0), 0);
    process.stdout.write(
      `${rows
        .map(([kind, count]) => `${kind.padEnd(labelWidth)}  ${count.padStart(countWidth)}`)
        .join("\n")}\n${"".padEnd(labelWidth)}  ${"-".repeat(countWidth)}\n${"total".padEnd(
        labelWidth,
      )}  ${total.toLocaleString("en-US").padStart(countWidth)}\n`,
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

    if (ctx.queryPath || ctx.format !== "table") {
      printDocument(ctx, catalog as unknown as Record<string, unknown>);
      return;
    }
    // The spec declares `contentUrl` as required, but the API returns null for a
    // kind that has no snapshot yet (verified against testphase: literature and
    // administrative-directives, both of which have zero documents there).
    const lines = (catalog.dataSet ?? []).map(
      (set) => `${set.name}\n  ${set.distribution?.contentUrl ?? "(no download URL)"}`,
    );
    process.stdout.write(`${lines.join("\n")}\n`);
  },
});

/**
 * Escape hatch for anything the typed commands do not cover — the hidden sitemap
 * and eclicrawler endpoints, or a new endpoint added after this CLI was built.
 */
export const rawCommand = defineCommand({
  meta: {
    name: "raw",
    description: "Request an arbitrary API path, with URL, auth and output handled",
  },
  args: {
    path: { type: "positional", description: "Path, e.g. /v1/case-law/courts", required: true },
    param: {
      type: "string",
      description: "Query parameter as key=value; repeatable",
      valueHint: "key=value",
    },
    ...globalArgs,
  },
  async run({ args, rawArgs }) {
    const ctx = await createContext(args);

    const query: Record<string, string[]> = {};
    // Not `list()`: a value may legitimately contain a comma, e.g. --param court="X, Y".
    for (const entry of collectRepeated(rawArgs, "param")) {
      const separator = entry.indexOf("=");
      if (separator < 1) {
        throw new Error(`--param expects key=value, got "${entry}".`);
      }
      const key = entry.slice(0, separator);
      (query[key] ??= []).push(entry.slice(separator + 1));
    }

    const response = await ctx.client.fetch({ path: args.path, query });
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("json")) {
      printDocument(ctx, (await response.json()) as Record<string, unknown>);
    } else {
      process.stdout.write(await response.text());
    }
  },
});

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
