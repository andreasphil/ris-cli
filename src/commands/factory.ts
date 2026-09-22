import { defineCommand } from "citty";
import type { components } from "../types/api.d.ts";
import {
  createContext,
  globalArgs,
  printDocument,
  writeData,
  writeNote,
  type Context,
} from "../shared.ts";

type ChangelogResponse = components["schemas"]["ChangelogResponse"];

/**
 * Verbs that are identical across all four document kinds: metadata, XML, HTML and
 * changelog. Only the base path and the example document number differ.
 */
export interface DocumentKind {
  /** Base path, e.g. `/v1/rechtsprechung`. */
  path: string;
  /** Human-readable singular noun for help text. */
  noun: string;
  exampleDocumentNumber: string;
}

export function metadataCommand(kind: DocumentKind) {
  return defineCommand({
    meta: { name: "get", description: `${capitalize(kind.noun)} metadata as JSON` },
    args: {
      documentNumber: {
        type: "positional",
        description: `Document number, e.g. ${kind.exampleDocumentNumber}`,
        required: true,
      },
      ...globalArgs,
    },
    async run({ args }) {
      const ctx = await createContext(args);
      const document = await ctx.client.json<Record<string, unknown>>({
        path: `${kind.path}/${encodeURIComponent(args.documentNumber)}`,
      });
      printDocument(ctx, document);
    },
  });
}

export function representationCommand(kind: DocumentKind, format: "xml" | "html") {
  return defineCommand({
    meta: {
      name: format,
      description: `${capitalize(kind.noun)} as ${format.toUpperCase()}`,
    },
    args: {
      documentNumber: {
        type: "positional",
        description: `Document number, e.g. ${kind.exampleDocumentNumber}`,
        required: true,
      },
      ...globalArgs,
    },
    async run({ args }) {
      const ctx = await createContext(args);
      const body = await ctx.client.text({
        path: `${kind.path}/${encodeURIComponent(args.documentNumber)}.${format}`,
        accept: format === "xml" ? "application/xml" : "text/html",
      });
      writeData(body);
    },
  });
}

/**
 * The API requires both `from` and `to` as date-times. Defaulting to the last 24
 * hours makes the common "what changed recently?" question a bare command.
 */
export function changelogCommand(kind: DocumentKind) {
  return defineCommand({
    meta: {
      name: "changelog",
      description: `Documents added, changed or deleted in a time window (default: last 24h)`,
    },
    args: {
      from: { type: "string", description: "Start of the window (date or ISO date-time)" },
      to: { type: "string", description: "End of the window (date or ISO date-time)" },
      ...globalArgs,
    },
    async run({ args }) {
      const ctx = await createContext(args);
      const now = new Date();
      const response = await ctx.client.json<ChangelogResponse>({
        path: `${kind.path}/changelog`,
        query: {
          from: toDateTime(asString(args.from), new Date(now.getTime() - 24 * 60 * 60 * 1000)),
          to: toDateTime(asString(args.to), now),
        },
      });
      printChangelog(ctx, response);
    },
  });
}

function printChangelog(ctx: Context, response: ChangelogResponse): void {
  if (ctx.format === "json") {
    printDocument(ctx, response as unknown as Record<string, unknown>);
    return;
  }

  // A note about the response, not part of it.
  if (response.allChanged) {
    writeNote("All documents changed (the storage was rebuilt).");
  }
  const lines = [
    ...(response.changed ?? []).map((entry) => `changed  ${entry["@id"] ?? entry.contentUrl}`),
    ...(response.deleted ?? []).map((entry) => `deleted  ${entry["@id"]}`),
  ];
  if (lines.length === 0) {
    writeNote("No changes in this window.");
    return;
  }
  writeData(lines.join("\n"));
  writeNote(
    `\n${response.changed?.length ?? 0} changed · ${response.deleted?.length ?? 0} deleted`,
  );
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Accepts a bare date or a full ISO timestamp; the API wants a date-time. */
export function toDateTime(value: string | undefined, fallback: Date): string {
  if (!value) return fallback.toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00Z`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Cannot parse "${value}" as a date or date-time.`);
  }
  return parsed.toISOString();
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
