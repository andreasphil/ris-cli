import { defineCommand } from "citty";
import { COLUMNS } from "../output.ts";
import {
  createContext,
  globalArgs,
  paginationArgs,
  printCollection,
  searchArgs,
  searchQuery,
} from "../shared.ts";
import {
  changelogCommand,
  metadataCommand,
  representationCommand,
  zipCommand,
  type DocumentKind,
} from "./factory.ts";

const KIND: DocumentKind = {
  path: "/v1/administrative-directive",
  noun: "administrative directive",
  exampleDocumentNumber: "KSNR00000",
};

const searchCommand = defineCommand({
  meta: { name: "search", description: "List and search administrative directives" },
  args: {
    terms: { type: "positional", description: "Search terms", required: false },
    "document-number": { type: "string", description: "Filter by document number" },
    ...searchArgs,
    ...globalArgs,
  },
  async run({ args }) {
    const ctx = await createContext(args);
    const terms = args._.join(" ").trim();
    await printCollection(
      ctx,
      KIND.path,
      {
        ...searchQuery(args, terms || undefined),
        documentNumber: asString(args["document-number"]),
      },
      COLUMNS.AdministrativeDirective,
    );
  },
});

const luceneCommand = defineCommand({
  meta: {
    name: "lucene",
    description: "Search administrative directives using Lucene query syntax",
  },
  args: {
    query: { type: "positional", description: "Lucene query", required: true },
    ...paginationArgs,
    ...globalArgs,
  },
  async run({ args }) {
    const ctx = await createContext(args);
    await printCollection(
      ctx,
      "/v1/document/lucene-search/administrative-directive",
      {
        query: args.query,
        size: asString(args.size),
        pageIndex: asString(args.page),
        sort: asString(args.sort),
      },
      COLUMNS.AdministrativeDirective,
    );
  },
});

export const directiveCommand = defineCommand({
  meta: {
    name: "directive",
    alias: ["ad"],
    description: "Administrative directives (Verwaltungsvorschriften)",
  },
  subCommands: {
    search: searchCommand,
    lucene: luceneCommand,
    get: metadataCommand(KIND),
    xml: representationCommand(KIND, "xml"),
    html: representationCommand(KIND, "html"),
    zip: zipCommand(KIND),
    changelog: changelogCommand(KIND),
  },
});

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
