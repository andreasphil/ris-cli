import { defineCommand } from "citty";
import type { components } from "../types/api.d.ts";
import type { RisClient } from "../client.ts";
import {
  expressionPath,
  isEliLike,
  manifestationDatePath,
  manifestationPath,
  parseEli,
  workPath,
  type ParsedEli,
} from "../eli.ts";
import { COLUMNS, TRANSLATION_COLUMNS, renderTable, type HydraCollection } from "../output.ts";
import type { LegislationTranslation, LegislationWorkExampleMember } from "../types/internal.ts";
import {
  createContext,
  fileOutputArgs,
  globalArgs,
  paginationArgs,
  printBinary,
  printCollection,
  printDocument,
  printText,
  searchArgs,
  searchQuery,
  unwrapFirstMember,
} from "../shared.ts";
import { changelogCommand, type DocumentKind } from "./factory.ts";

type LegislationExpressionSchema = components["schemas"]["LegislationExpressionSchema"];
type LegislationExpressionPartSchema = components["schemas"]["LegislationExpressionPartSchema"];

const KIND: DocumentKind = {
  path: "/v1/legislation",
  noun: "legislation",
  exampleDocumentNumber: "eli/bund/bgbl-1/1979/s1325/2020-06-19/2/deu",
};

const ELI_HINT =
  "ELI, or an abbreviation such as BGB. Accepts work, expression or manifestation level, " +
  "with or without an eli/ prefix, and tolerates a pasted URL.";

/**
 * Resolves whatever the user typed into an expression-level ELI.
 *
 * An abbreviation (`BGB`) is looked up via the search endpoint with
 * `mostRelevantOn=today`, which is what the portal itself does to pick the version
 * a reader most likely wants.
 */
async function resolveExpression(
  client: RisClient,
  input: string,
  onDate?: string,
): Promise<ParsedEli> {
  if (isEliLike(input)) {
    const eli = parseEli(input);
    if (eli.level === "work") {
      return resolveWork(client, eli, onDate);
    }
    return eli;
  }

  const date = onDate ?? new Date().toISOString().slice(0, 10);
  // risAbbreviation is the RIS-internal short form and the more reliable match;
  // fall back to the official abbreviation before giving up.
  for (const field of ["risAbbreviation", "abbreviation"] as const) {
    const collection = await client.json<HydraCollection>({
      path: KIND.path,
      query: { [field]: input, mostRelevantOn: date, size: 1 },
      internal: true,
    });
    const item = unwrapFirstMember<LegislationWorkExampleMember>(collection);
    if (item?.legislationIdentifier) return parseEli(item.legislationIdentifier);
  }

  throw new Error(
    `No legislation found for "${input}".\n` +
      `  Searched by abbreviation for ${date}. Try \`ris legislation search ${input}\` ` +
      `to find the right ELI.`,
  );
}

/** Picks one expression out of a work ELI, preferring the one in force on a date. */
async function resolveWork(client: RisClient, eli: ParsedEli, onDate?: string): Promise<ParsedEli> {
  const date = onDate ?? new Date().toISOString().slice(0, 10);
  const collection = await client.json<HydraCollection>({
    path: KIND.path,
    query: { eli: `eli/${workPath(eli)}`, mostRelevantOn: date, size: 1 },
    internal: true,
  });
  const item = unwrapFirstMember<LegislationWorkExampleMember>(collection);
  if (!item?.legislationIdentifier) {
    throw new Error(
      `No expression found for work ELI eli/${workPath(eli)} around ${date}.\n` +
        `  List all of them with: ris legislation versions eli/${workPath(eli)}`,
    );
  }
  return parseEli(item.legislationIdentifier);
}

/**
 * Turns an expression-level ELI into a manifestation path by reading the real
 * manifestation URL out of the expression's `encoding` array, rather than guessing
 * the manifestation date and subtype.
 */
async function resolveManifestation(
  client: RisClient,
  eli: ParsedEli,
  format: "xml" | "html" | "zip",
): Promise<{ eli: ParsedEli; contentUrl?: string }> {
  if (eli.level === "manifestation" || eli.level === "manifestation-date") {
    return { eli };
  }

  const expression = await client.json<LegislationExpressionSchema>({
    path: `${KIND.path}/eli/${expressionPath(eli)}`,
    internal: true,
  });

  const mimeType = { xml: "application/xml", html: "text/html", zip: "application/zip" }[format];
  const encoding = expression.encoding?.find((entry) => entry.encodingFormat === mimeType);
  if (encoding?.contentUrl) {
    return { eli: parseEli(encoding.contentUrl), contentUrl: encoding.contentUrl };
  }

  const available = expression.encoding
    ?.map((entry) => entry.encodingFormat)
    .filter(Boolean)
    .join(", ");
  throw new Error(
    `Expression eli/${expressionPath(eli)} has no ${format.toUpperCase()} manifestation.` +
      (available ? `\n  Available formats: ${available}` : ""),
  );
}

const searchCommand = defineCommand({
  meta: { name: "search", description: "List and search legislation" },
  args: {
    terms: { type: "positional", description: "Search terms", required: false },
    eli: { type: "string", description: "Filter by work ELI" },
    abbreviation: { type: "string", description: "Filter by official abbreviation" },
    "ris-abbreviation": { type: "string", description: "Filter by RIS abbreviation" },
    "in-force-on": {
      type: "string",
      description: "Only expressions in force on this date (sets both temporal bounds)",
      valueHint: "date",
    },
    "temporal-from": {
      type: "string",
      description: "Only expressions in force on or after this date",
      valueHint: "date",
    },
    "temporal-to": {
      type: "string",
      description: "Only expressions in force on or before this date",
      valueHint: "date",
    },
    "most-relevant-on": {
      type: "string",
      description: "Return exactly one expression per work, the most relevant for this date",
      valueHint: "date",
    },
    ...searchArgs,
    ...globalArgs,
  },
  async run({ args }) {
    const ctx = await createContext(args);
    const terms = args._.join(" ").trim();
    const inForceOn = asString(args["in-force-on"]);
    await printCollection(
      ctx,
      KIND.path,
      {
        ...searchQuery(args, terms || undefined),
        eli: asString(args.eli),
        abbreviation: asString(args.abbreviation),
        risAbbreviation: asString(args["ris-abbreviation"]),
        temporalCoverageFrom: inForceOn ?? asString(args["temporal-from"]),
        temporalCoverageTo: inForceOn ?? asString(args["temporal-to"]),
        mostRelevantOn: asString(args["most-relevant-on"]),
      },
      COLUMNS.Legislation,
    );
  },
});

const luceneCommand = defineCommand({
  meta: { name: "lucene", description: "Search legislation using Lucene query syntax" },
  args: {
    query: { type: "positional", description: "Lucene query", required: true },
    ...paginationArgs,
    ...globalArgs,
  },
  async run({ args }) {
    const ctx = await createContext(args);
    await printCollection(
      ctx,
      "/v1/document/lucene-search/legislation",
      {
        query: args.query,
        size: asString(args.size),
        pageIndex: asString(args.page),
        sort: asString(args.sort),
      },
      COLUMNS.Legislation,
    );
  },
});

const getCommand = defineCommand({
  meta: { name: "get", description: "Expression-level metadata" },
  args: {
    eli: { type: "positional", description: ELI_HINT, required: true },
    "on-date": {
      type: "string",
      description: "Date used when resolving an abbreviation or work ELI (default: today)",
      valueHint: "date",
    },
    ...globalArgs,
  },
  async run({ args }) {
    const ctx = await createContext(args);
    const eli = await resolveExpression(ctx.client, args.eli, asString(args["on-date"]));
    const expression = await ctx.client.json<Record<string, unknown>>({
      path: `${KIND.path}/eli/${expressionPath(eli)}`,
    });
    printDocument(ctx, expression);
  },
});

/** Uses the undocumented work-example endpoint (NormsController is @Hidden here). */
const versionsCommand = defineCommand({
  meta: {
    name: "versions",
    description: "Every expression (version) of a piece of legislation",
  },
  args: {
    eli: {
      type: "positional",
      description: "Work, expression or manifestation ELI",
      required: true,
    },
    ...globalArgs,
  },
  async run({ args }) {
    const ctx = await createContext(args);
    const eli = isEliLike(args.eli)
      ? parseEli(args.eli)
      : await resolveExpression(ctx.client, args.eli);
    await printCollection(
      ctx,
      `${KIND.path}/work-example/eli/${workPath(eli)}`,
      {},
      COLUMNS.Legislation,
    );
  },
});

function representation(format: "xml" | "html") {
  return defineCommand({
    meta: {
      name: format,
      description: `Legislation text as ${format.toUpperCase()}, resolving the manifestation automatically`,
    },
    args: {
      eli: { type: "positional", description: ELI_HINT, required: true },
      "on-date": {
        type: "string",
        description: "Date used when resolving an abbreviation or work ELI (default: today)",
        valueHint: "date",
      },
      ...fileOutputArgs,
      ...globalArgs,
    },
    async run({ args }) {
      const ctx = await createContext(args);
      const expression = await resolveExpression(ctx.client, args.eli, asString(args["on-date"]));
      const { eli } = await resolveManifestation(ctx.client, expression, format);
      const body = await ctx.client.text({
        path: `${KIND.path}/eli/${manifestationPath(eli)}.${format}`,
        accept: format === "xml" ? "application/xml" : "text/html",
      });
      await printText(ctx, body);
    },
  });
}

const articleCommand = defineCommand({
  meta: { name: "article", description: "A single article (§) as HTML" },
  args: {
    eli: { type: "positional", description: ELI_HINT, required: true },
    articleEid: {
      type: "positional",
      description: "Article expression identifier, e.g. art-z1 (see `ris legislation toc`)",
      required: true,
    },
    "on-date": { type: "string", description: "Date used when resolving (default: today)" },
    ...fileOutputArgs,
    ...globalArgs,
  },
  async run({ args }) {
    const ctx = await createContext(args);
    const expression = await resolveExpression(ctx.client, args.eli, asString(args["on-date"]));
    const { eli } = await resolveManifestation(ctx.client, expression, "html");
    const body = await ctx.client.text({
      path: `${KIND.path}/eli/${manifestationPath(eli)}/${args.articleEid}.html`,
      accept: "text/html",
    });
    await printText(ctx, body);
  },
});

const zipCommand = defineCommand({
  meta: { name: "zip", description: "Manifestation as a ZIP archive (XML plus attachments)" },
  args: {
    eli: { type: "positional", description: ELI_HINT, required: true },
    "on-date": { type: "string", description: "Date used when resolving (default: today)" },
    ...fileOutputArgs,
    ...globalArgs,
  },
  async run({ args }) {
    const ctx = await createContext(args);
    const expression = await resolveExpression(ctx.client, args.eli, asString(args["on-date"]));
    // The ZIP endpoint omits the subtype segment, so resolve via the XML encoding
    // and address the manifestation by date alone.
    const { eli } = await resolveManifestation(ctx.client, expression, "xml");
    const result = await ctx.client.bytes({
      path: `${KIND.path}/eli/${manifestationDatePath(eli)}.zip`,
      accept: "application/zip",
    });
    await printBinary(ctx, result, `${eli.naturalIdentifier}-${eli.pointInTime}.zip`);
  },
});

const resourceCommand = defineCommand({
  meta: { name: "resource", description: "A file (PDF, image, XML) inside a manifestation" },
  args: {
    eli: { type: "positional", description: "Expression or manifestation ELI", required: true },
    filename: {
      type: "positional",
      description: "File name with extension: pdf, xml, jpg or gif",
      required: true,
    },
    ...fileOutputArgs,
    ...globalArgs,
  },
  async run({ args }) {
    const ctx = await createContext(args);
    const expression = await resolveExpression(ctx.client, args.eli);
    const { eli } = await resolveManifestation(ctx.client, expression, "xml");
    const result = await ctx.client.bytes({
      path: `${KIND.path}/eli/${manifestationDatePath(eli)}/${args.filename}`,
    });
    await printBinary(ctx, result, args.filename);
  },
});

const tocCommand = defineCommand({
  meta: {
    name: "toc",
    description: "Table of contents, with the article eIds needed by `article`",
  },
  args: {
    eli: { type: "positional", description: ELI_HINT, required: true },
    "on-date": { type: "string", description: "Date used when resolving (default: today)" },
    ...globalArgs,
  },
  async run({ args }) {
    const ctx = await createContext(args);
    const eli = await resolveExpression(ctx.client, args.eli, asString(args["on-date"]));
    const expression = await ctx.client.json<LegislationExpressionSchema>({
      path: `${KIND.path}/eli/${expressionPath(eli)}`,
    });

    if (ctx.format === "json") {
      printDocument(ctx, (expression.hasPart ?? []) as unknown as Record<string, unknown>);
      return;
    }
    const lines = renderParts(expression.hasPart ?? [], "");
    process.stdout.write(
      lines.length > 0 ? `${lines.join("\n")}\n` : "This expression has no articles.\n",
    );
  },
});

function renderParts(parts: LegislationExpressionPartSchema[], indent: string): string[] {
  return parts.flatMap((part) => {
    const label = [part.name, part.headline].filter(Boolean).join(" — ") || "(untitled)";
    return [
      `${indent}${(part.eId ?? "").padEnd(Math.max(0, 22 - indent.length))}  ${label}`,
      ...renderParts(part.hasPart ?? [], `${indent}  `),
    ];
  });
}

/** Undocumented endpoint: English translations of selected legislation. */
const translationsCommand = defineCommand({
  meta: { name: "translations", description: "English translations of selected legislation" },
  args: {
    id: { type: "positional", description: "Abbreviation to filter by", required: false },
    filename: {
      type: "string",
      description: "Fetch one translation as HTML by its filename",
      valueHint: "name",
    },
    ...fileOutputArgs,
    ...globalArgs,
  },
  async run({ args }) {
    const ctx = await createContext(args);
    const filename = asString(args.filename);
    if (filename) {
      await printText(
        ctx,
        await ctx.client.text({
          path: `/v1/translatedLegislation/${encodeURIComponent(filename)}`,
          accept: "text/html",
        }),
      );
      return;
    }
    const translations = await ctx.client.json<LegislationTranslation[]>({
      path: "/v1/translatedLegislation",
      query: { id: args.id },
    });
    if (ctx.format === "json") {
      printDocument(ctx, translations as unknown as Record<string, unknown>);
      return;
    }
    process.stdout.write(
      `${renderTable(translations as unknown as Record<string, unknown>[], TRANSLATION_COLUMNS)}\n`,
    );
  },
});

export const legislationCommand = defineCommand({
  meta: { name: "legislation", alias: ["leg"], description: "Laws and decrees (Gesetze)" },
  subCommands: {
    search: searchCommand,
    lucene: luceneCommand,
    get: getCommand,
    versions: versionsCommand,
    toc: tocCommand,
    xml: representation("xml"),
    html: representation("html"),
    article: articleCommand,
    zip: zipCommand,
    resource: resourceCommand,
    translations: translationsCommand,
    changelog: changelogCommand(KIND),
  },
});

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
