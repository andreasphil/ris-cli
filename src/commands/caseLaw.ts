import { defineCommand } from "citty";
import type { components } from "../types/api.d.ts";
import { COLUMNS } from "../output.ts";
import {
  createContext,
  globalArgs,
  list,
  paginationArgs,
  printBinary,
  printCollection,
  printRows,
  requireRedirectedStdout,
  searchArgs,
  searchQuery,
} from "../shared.ts";
import {
  changelogCommand,
  metadataCommand,
  representationCommand,
  type DocumentKind,
} from "./factory.ts";

type CourtSearchResult = components["schemas"]["CourtSearchResult"];

const KIND: DocumentKind = {
  path: "/v1/case-law",
  noun: "court decision",
  exampleDocumentNumber: "STRE201770751",
};

const searchCommand = defineCommand({
  meta: { name: "search", description: "List and search court decisions" },
  args: {
    terms: { type: "positional", description: "Search terms", required: false },
    court: {
      type: "string",
      description: 'Court name or type, long or short (e.g. "FG Münster", "Finanzgericht")',
    },
    "file-number": { type: "string", description: "Aktenzeichen" },
    ecli: { type: "string", description: "European Case Law Identifier" },
    "legal-effect": {
      type: "enum",
      options: ["JA", "NEIN", "KEINE_ANGABE", "FALSCHE_ANGABE"],
      description: "Rechtskraft — whether the decision is legally binding",
    },
    type: {
      type: "string",
      description: "Document type (Urteil, Beschluss, …); repeatable or comma-separated",
    },
    "type-group": {
      type: "string",
      description: "Type group: Urteil, Beschluss or other; repeatable",
    },
    ...searchArgs,
    ...globalArgs,
  },
  async run({ args, rawArgs }) {
    const ctx = await createContext(args);
    const terms = args._.join(" ").trim();
    await printCollection(
      ctx,
      KIND.path,
      {
        ...searchQuery(args, terms || undefined),
        court: asString(args.court),
        fileNumber: asString(args["file-number"]),
        ecli: asString(args.ecli),
        legalEffect: asString(args["legal-effect"]),
        type: list(rawArgs, "type"),
        typeGroup: list(rawArgs, "type-group"),
      },
      COLUMNS.CaseLaw,
    );
  },
});

const luceneCommand = defineCommand({
  meta: { name: "lucene", description: "Search court decisions using Lucene query syntax" },
  args: {
    query: { type: "positional", description: "Lucene query", required: true },
    ...paginationArgs,
    ...globalArgs,
  },
  async run({ args }) {
    const ctx = await createContext(args);
    await printCollection(
      ctx,
      "/v1/document/lucene-search/case-law",
      {
        query: args.query,
        size: asString(args.size),
        pageIndex: asString(args.page),
        sort: asString(args.sort),
      },
      COLUMNS.CaseLaw,
    );
  },
});

const zipCommand = defineCommand({
  meta: { name: "zip", description: "Decision as a ZIP archive (XML plus attachments)" },
  args: {
    documentNumber: { type: "positional", description: "Document number", required: true },
    ...globalArgs,
  },
  async run({ args }) {
    // Fail before spending the request: binary output has nowhere to go on a TTY.
    requireRedirectedStdout();
    const ctx = await createContext(args);
    const data = await ctx.client.bytes({
      path: `${KIND.path}/${encodeURIComponent(args.documentNumber)}.zip`,
      accept: "application/zip",
    });
    printBinary(data);
  },
});

const resourceCommand = defineCommand({
  meta: { name: "resource", description: "An image or other file embedded in a decision" },
  args: {
    documentNumber: { type: "positional", description: "Document number", required: true },
    filename: {
      type: "positional",
      description: "File name with extension, e.g. image.jpg",
      required: true,
    },
    ...globalArgs,
  },
  async run({ args }) {
    // Fail before spending the request: binary output has nowhere to go on a TTY.
    requireRedirectedStdout();
    const ctx = await createContext(args);
    const data = await ctx.client.bytes({
      path: `${KIND.path}/${encodeURIComponent(args.documentNumber)}/${args.filename}`,
    });
    printBinary(data);
  },
});

const courtsCommand = defineCommand({
  meta: {
    name: "courts",
    description: "Courts that have decisions in the database, with decision counts",
  },
  args: {
    prefix: {
      type: "positional",
      description: "Only courts whose name starts with this prefix",
      required: false,
    },
    ...globalArgs,
  },
  async run({ args }) {
    const ctx = await createContext(args);
    const courts = await ctx.client.json<CourtSearchResult[]>({
      path: `${KIND.path}/courts`,
      query: { prefix: args.prefix },
    });

    printRows(
      ctx,
      courts as unknown as Record<string, unknown>[],
      COLUMNS.Court!,
      `${courts.length} courts`,
    );
  },
});

export const caseLawCommand = defineCommand({
  meta: { name: "case-law", alias: ["cl"], description: "Court decisions (Rechtsprechung)" },
  subCommands: {
    search: searchCommand,
    lucene: luceneCommand,
    get: metadataCommand(KIND),
    xml: representationCommand(KIND, "xml"),
    html: representationCommand(KIND, "html"),
    zip: zipCommand,
    resource: resourceCommand,
    courts: courtsCommand,
    changelog: changelogCommand(KIND),
  },
});

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
