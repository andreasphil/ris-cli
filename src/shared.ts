import type { ArgsDef } from "citty";
import { RisClient, type Query } from "./client.ts";
import { loadConfig, resolveTarget } from "./config.ts";
import {
  columnsFor,
  paginationFooter,
  renderDetail,
  renderTable,
  resolveFormat,
  unwrapMembers,
  type Column,
  type HydraCollection,
  type OutputFormat,
} from "./output.ts";

/**
 * citty does not merge parent args into subcommands, so these are spread into
 * every leaf command's `args`.
 */
export const globalArgs = {
  profile: {
    type: "string",
    description: "Named profile from the config file, providing the URL and credentials",
    valueHint: "name",
    alias: "p",
  },
  output: {
    type: "enum",
    options: ["json", "table"],
    description: "Output format (default: table on a TTY, else json)",
    valueHint: "format",
    alias: "o",
  },
  "dry-run": { type: "boolean", description: "Print the equivalent curl command and exit" },
  verbose: { type: "boolean", description: "Log requests to stderr", alias: "v" },
  timeout: { type: "string", description: "Request timeout in seconds (default: 30)" },
} as const satisfies ArgsDef;

/**
 * `config check` takes the profile as a positional, which would collide with the
 * global `--profile` flag in the same args object.
 */
export const { profile: _profileArg, ...globalArgsWithoutProfile } = globalArgs;

export const paginationArgs = {
  size: { type: "string", description: "Results per page, 1-300 (default: 100)" },
  page: { type: "string", description: "Page index, 0-based (default: 0)" },
  sort: {
    type: "string",
    description: "Sort field; prefix with - for descending, e.g. -date",
    valueHint: "field",
  },
} as const satisfies ArgsDef;

export const dateFilterArgs = {
  from: { type: "string", description: "Only documents dated on or after this date (YYYY-MM-DD)" },
  to: { type: "string", description: "Only documents dated on or before this date (YYYY-MM-DD)" },
} as const satisfies ArgsDef;

export const searchArgs = {
  ...dateFilterArgs,
  ...paginationArgs,
} as const satisfies ArgsDef;

/**
 * `ParsedArgs<ArgsDef>` collapses its index signature to `never`, so concrete
 * per-command arg types are not assignable to it. This is the structural shape all
 * of them satisfy.
 */
export type AnyArgs = { _: string[] } & Record<
  string,
  string | number | boolean | string[] | undefined
>;

function flag(args: AnyArgs, name: string): string | undefined {
  const value = args[name];
  if (value === undefined || value === null || typeof value === "boolean") return undefined;
  return Array.isArray(value) ? value[value.length - 1] : String(value);
}

function bool(args: AnyArgs, name: string): boolean {
  return args[name] === true;
}

/**
 * Collects every occurrence of a repeated string flag.
 *
 * citty's parser keeps only the last value of a repeated flag, so
 * `--type A --type B` would silently drop `A`. The API accepts multi-value
 * filters either repeated or comma-separated, and users reasonably try both, so we
 * read the repeats straight out of the raw argv.
 */
export function collectRepeated(rawArgs: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index]!;
    if (arg === `--${name}`) {
      const next = rawArgs[index + 1];
      // A following token starting with - is the next flag, not this flag's value.
      if (next !== undefined && !next.startsWith("-")) {
        values.push(next);
        index += 1;
      }
    } else if (arg.startsWith(`--${name}=`)) {
      values.push(arg.slice(name.length + 3));
    }
  }
  return values;
}

/** Repeated occurrences plus comma-separated values, which the API accepts equally. */
export function list(rawArgs: string[], name: string): string[] | undefined {
  const entries = collectRepeated(rawArgs, name)
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.length > 0 ? entries : undefined;
}

function positiveInt(args: AnyArgs, name: string): number | undefined {
  const raw = flag(args, name);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--${name} must be a non-negative integer, got "${raw}".`);
  }
  return parsed;
}

export interface Context {
  client: RisClient;
  format: OutputFormat;
}

/** Builds the client and resolves output settings from the parsed args. */
export async function createContext(args: AnyArgs): Promise<Context> {
  const config = await loadConfig();
  const target = await resolveTarget(config, flag(args, "profile"));

  const timeoutSeconds = flag(args, "timeout");
  const client = new RisClient({
    target,
    dryRun: bool(args, "dry-run"),
    verbose: bool(args, "verbose"),
    timeoutMs: timeoutSeconds ? Number(timeoutSeconds) * 1000 : undefined,
  });

  return {
    client,
    format: resolveFormat(flag(args, "output"), Boolean(process.stdout.isTTY)),
  };
}

/** Query parameters shared by every search endpoint. */
export function searchQuery(args: AnyArgs, searchTerm?: string): Query {
  return {
    searchTerm,
    dateFrom: flag(args, "from"),
    dateTo: flag(args, "to"),
    size: positiveInt(args, "size"),
    pageIndex: positiveInt(args, "page"),
    sort: flag(args, "sort"),
  };
}

/**
 * Data — the thing a pipeline consumes. Everything a command produces as output
 * goes through here, so there is one place that owns "this belongs on stdout".
 */
export function writeData(text: string): void {
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

/**
 * A note *about* the data: row counts, pagination hints, empty-result messages.
 * Kept off stdout so a pipeline sees only rows — and nothing at all when there
 * are none.
 */
export function writeNote(text: string): void {
  process.stderr.write(text.endsWith("\n") ? text : `${text}\n`);
}

/**
 * Renders a list of documents: JSON when asked for, otherwise a table with an
 * optional footer. Owns the data/note split for every array-shaped result, so the
 * rule is stated once rather than restated per command.
 */
export function printRows(
  ctx: Context,
  rows: Record<string, unknown>[],
  columns: Column[],
  footer?: string,
): void {
  if (ctx.format === "json") {
    writeData(JSON.stringify(rows, null, 2));
    return;
  }
  if (rows.length === 0) {
    writeNote("No results.");
    return;
  }
  writeData(renderTable(rows, columns));
  if (footer) writeNote(`\n${footer}`);
}

/** Renders one page of a search response. */
export async function printCollection(
  ctx: Context,
  path: string,
  query: Query,
  columns?: Column[],
): Promise<void> {
  const collection = await ctx.client.json<HydraCollection>({ path, query });
  // JSON keeps the Hydra envelope, so `view.next` and `totalItems` stay visible.
  if (ctx.format === "json") {
    writeData(JSON.stringify(collection, null, 2));
    return;
  }

  const items = unwrapMembers<Record<string, unknown>>(collection);
  const pageIndex = Number(query.pageIndex ?? 0);
  printRows(ctx, items, columns ?? columnsFor(items), paginationFooter(collection, pageIndex));
}

/** First document of a collection, for the single-result lookups used in ELI resolution. */
export function unwrapFirstMember<T>(collection: HydraCollection): T | undefined {
  return unwrapMembers<T>(collection)[0];
}

/** Renders a single document: key/value on a TTY, JSON otherwise. */
export function printDocument(ctx: Context, document: Record<string, unknown>): void {
  if (ctx.format === "table") {
    writeData(renderDetail(document));
    return;
  }
  writeData(JSON.stringify(document, null, 2));
}

/**
 * Binary output only ever goes to stdout, so a terminal is the one destination it
 * cannot have. Commands assert this *before* fetching — see `printBinary`.
 */
export function requireRedirectedStdout(): void {
  if (process.stdout.isTTY) {
    throw new Error(
      "Refusing to write binary data to the terminal.\n" +
        "  Redirect it to a file or pipe it, e.g. `> out.zip` or `| unzip -l -`.",
    );
  }
}

/** Writes binary content to stdout. The guard is a backstop; commands check first. */
export function printBinary(data: Uint8Array): void {
  requireRedirectedStdout();
  process.stdout.write(data);
}
