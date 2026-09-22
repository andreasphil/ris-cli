import { defineCommand } from "citty";
import { COLUMNS } from "../output.ts";
import {
  createContext,
  globalArgs,
  list,
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
  path: "/v1/literature",
  noun: "literature item",
  exampleDocumentNumber: "BJLU075748788",
};

const searchCommand = defineCommand({
  meta: { name: "search", description: "List and search literature" },
  args: {
    terms: { type: "positional", description: "Search terms", required: false },
    "document-number": { type: "string", description: "Filter by document number" },
    year: {
      type: "string",
      description: "Year of publication; repeatable or comma-separated",
    },
    type: { type: "string", description: "Document type; repeatable or comma-separated" },
    author: { type: "string", description: "Author; repeatable" },
    collaborator: { type: "string", description: "Collaborator; repeatable" },
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
        documentNumber: asString(args["document-number"]),
        yearOfPublication: list(rawArgs, "year"),
        documentType: list(rawArgs, "type"),
        author: list(rawArgs, "author"),
        collaborator: list(rawArgs, "collaborator"),
      },
      COLUMNS.Literature,
    );
  },
});

const luceneCommand = defineCommand({
  meta: { name: "lucene", description: "Search literature using Lucene query syntax" },
  args: {
    query: { type: "positional", description: "Lucene query", required: true },
    ...paginationArgs,
    ...globalArgs,
  },
  async run({ args }) {
    const ctx = await createContext(args);
    await printCollection(
      ctx,
      "/v1/document/lucene-search/literature",
      {
        query: args.query,
        size: asString(args.size),
        pageIndex: asString(args.page),
        sort: asString(args.sort),
      },
      COLUMNS.Literature,
    );
  },
});

export const literatureCommand = defineCommand({
  meta: { name: "literature", alias: ["lit"], description: "Legal literature (Literatur)" },
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
