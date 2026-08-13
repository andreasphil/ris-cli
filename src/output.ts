/**
 * Output formatting.
 *
 * Search endpoints wrap results in a Hydra collection whose documents sit two
 * levels down at `member[].item`. Unwrapping that by default is the single
 * biggest readability win over curling the API by hand.
 */

export type OutputFormat = "json" | "table";

export interface HydraView {
  first?: string;
  previous?: string;
  next?: string;
  last?: string;
}

export interface HydraCollection<T = unknown> {
  "@id"?: string;
  "@type"?: string;
  totalItems: number;
  member: T[];
  view?: HydraView;
}

export interface SearchMember<T = unknown> {
  "@type"?: string;
  item?: T;
  textMatches?: { name?: string; text?: string; location?: string | null }[];
}

export function isHydraCollection(value: unknown): value is HydraCollection {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as HydraCollection).member) &&
    typeof (value as HydraCollection).totalItems === "number"
  );
}

/** Pulls the documents out of `member[].item`, tolerating members that are bare documents. */
export function unwrapMembers<T = Record<string, unknown>>(collection: HydraCollection): T[] {
  return collection.member.map((member) => {
    const candidate = member as SearchMember<T>;
    return (candidate?.item ?? member) as T;
  });
}

export function resolveFormat(explicit: string | undefined, isTty: boolean): OutputFormat {
  if (explicit) {
    if (!["json", "table"].includes(explicit)) {
      throw new Error(`Unknown output format "${explicit}". Use json or table.`);
    }
    return explicit as OutputFormat;
  }
  return isTty ? "table" : "json";
}

export interface Column {
  header: string;
  /** Field name, or a getter for values that need assembling. */
  get: string | ((row: Record<string, unknown>) => unknown);
  maxWidth?: number;
}

function cellValue(row: Record<string, unknown>, column: Column): string {
  const raw = typeof column.get === "function" ? column.get(row) : row[column.get];
  if (raw === undefined || raw === null) return "";
  if (Array.isArray(raw)) return raw.filter(Boolean).join(", ");
  if (typeof raw === "object") return JSON.stringify(raw);
  return String(raw).replace(/\s+/g, " ").trim();
}

function truncate(value: string, width: number): string {
  return value.length <= width ? value : `${value.slice(0, Math.max(0, width - 1))}…`;
}

export function renderTable(
  rows: Record<string, unknown>[],
  columns: Column[],
  terminalWidth = process.stdout.columns || 120,
): string {
  if (rows.length === 0) return "No results.";

  const cells = rows.map((row) => columns.map((column) => cellValue(row, column)));
  const widths = columns.map((column, index) => {
    const longest = Math.max(column.header.length, ...cells.map((row) => row[index]?.length ?? 0));
    return Math.min(longest, column.maxWidth ?? Infinity);
  });

  // Give the last column whatever horizontal space is left over.
  const separatorWidth = (columns.length - 1) * 2;
  const fixedWidth = widths.slice(0, -1).reduce((sum, width) => sum + width, 0) + separatorWidth;
  const lastIndex = widths.length - 1;
  if (lastIndex >= 0) {
    widths[lastIndex] = Math.max(8, Math.min(widths[lastIndex]!, terminalWidth - fixedWidth));
  }

  const line = (values: string[]) =>
    values
      .map((value, index) => {
        const width = widths[index]!;
        const text = truncate(value, width);
        return index === lastIndex ? text : text.padEnd(width);
      })
      .join("  ")
      .trimEnd();

  return [line(columns.map((column) => column.header.toUpperCase())), ...cells.map(line)].join(
    "\n",
  );
}

const CASE_LAW_COLUMNS: Column[] = [
  { header: "document number", get: "documentNumber" },
  { header: "date", get: "decisionDate" },
  { header: "court", get: "courtName", maxWidth: 28 },
  { header: "type", get: "documentType", maxWidth: 16 },
  { header: "title", get: (row) => row.headline ?? row.decisionName ?? row.titleLine },
];

/**
 * Per-document-kind columns, keyed by the `@type` discriminator as the API actually
 * emits it. Case law reports `Decision`, not `CaseLaw`.
 */
export const COLUMNS: Record<string, Column[]> = {
  Decision: CASE_LAW_COLUMNS,
  CaseLaw: CASE_LAW_COLUMNS,
  Legislation: [
    {
      header: "abbreviation",
      get: (row) => row.abbreviation ?? row.risAbbreviation,
      maxWidth: 18,
    },
    { header: "in force", get: "legislationLegalForce", maxWidth: 18 },
    { header: "coverage", get: "temporalCoverage", maxWidth: 23 },
    { header: "name", get: (row) => row.alternateName ?? row.name },
  ],
  Literature: [
    { header: "document number", get: "documentNumber" },
    { header: "year", get: (row) => row.yearsOfPublication ?? row.firstPublicationDate },
    { header: "type", get: "documentTypes", maxWidth: 16 },
    { header: "authors", get: "authors", maxWidth: 24 },
    { header: "title", get: "headline" },
  ],
  AdministrativeDirective: [
    { header: "document number", get: "documentNumber" },
    { header: "type", get: "documentType", maxWidth: 12 },
    { header: "in force from", get: "entryIntoForceDate" },
    { header: "authority", get: "legislationAuthority", maxWidth: 20 },
    { header: "title", get: "headline" },
  ],
  Court: [
    { header: "short name", get: "id", maxWidth: 24 },
    { header: "decisions", get: "count" },
    { header: "name", get: "label" },
  ],
};

/**
 * Columns for the undocumented `/v1/translatedLegislation` list.
 *
 * Kept out of `COLUMNS` deliberately: those are keyed by the `@type`
 * discriminator, and a translation reports `@type: "Legislation"`, which would
 * collide with the legislation columns. The keys here are JSON-LD names because the
 * backend maps its `id` and `filename` fields to `@id` and `ris:filename`.
 */
export const TRANSLATION_COLUMNS: Column[] = [
  { header: "id", get: "@id", maxWidth: 16 },
  { header: "filename", get: "ris:filename", maxWidth: 36 },
  { header: "name", get: "name" },
];

/** Columns for mixed result sets, where each row may be a different document kind. */
const MIXED_COLUMNS: Column[] = [
  { header: "kind", get: "@type", maxWidth: 24 },
  {
    header: "id",
    get: (row) => row.documentNumber ?? row.legislationIdentifier ?? row.abbreviation,
    maxWidth: 24,
  },
  {
    header: "date",
    get: (row) => row.decisionDate ?? row.temporalCoverage ?? row.entryIntoForceDate,
    maxWidth: 23,
  },
  {
    header: "title",
    get: (row) => row.headline ?? row.name ?? row.alternateName ?? row.decisionName,
  },
];

export function columnsFor(rows: Record<string, unknown>[]): Column[] {
  const kinds = new Set(rows.map((row) => String(row["@type"] ?? "")));
  if (kinds.size === 1) {
    const [kind] = [...kinds];
    const known = COLUMNS[kind ?? ""];
    if (known) return known;
  }
  return MIXED_COLUMNS;
}

/** Key/value rendering for a single document, so `get` is readable on a TTY. */
export function renderDetail(document: Record<string, unknown>): string {
  const entries = Object.entries(document).filter(
    ([key, value]) =>
      !key.startsWith("@") &&
      value !== null &&
      value !== undefined &&
      value !== "" &&
      !(Array.isArray(value) && value.length === 0),
  );
  const labelWidth = Math.max(...entries.map(([key]) => key.length), 0);
  return entries
    .map(([key, value]) => {
      const rendered = Array.isArray(value)
        ? value
            .map((entry) => (typeof entry === "object" ? JSON.stringify(entry) : entry))
            .join(", ")
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
      return `${key.padEnd(labelWidth)}  ${rendered.replace(/\s+/g, " ").trim()}`;
    })
    .join("\n");
}

export function paginationFooter(collection: HydraCollection, pageIndex: number): string {
  const shown = collection.member.length;
  if (shown === 0) return "No results.";
  const total = collection.totalItems.toLocaleString("en-US");
  const parts = [`Showing ${shown} of ${total}`];
  if (collection.view?.next) parts.push(`next: --page ${pageIndex + 1}`);
  return parts.join(" · ");
}
