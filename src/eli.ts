/**
 * European Legislation Identifier (ELI) parsing.
 *
 * The API addresses legislation at three FRBR levels, each adding path segments:
 *
 *   work           bund/bgbl-1/1979/s1325                                    (4)
 *   expression     …/2020-06-19/2/deu                                        (7)
 *   manifestation  …/2020-06-19/regelungstext-1                              (9)
 *
 * The 8-segment form (expression + manifestation date, no subtype) is a real
 * addressing level too: the `.zip` endpoint and manifestation resources omit the
 * subtype. See `spec/openapi.json` for the endpoint shapes.
 */

export type EliLevel = "work" | "expression" | "manifestation-date" | "manifestation";

export interface ParsedEli {
  level: EliLevel;
  jurisdiction: string;
  agent: string;
  year: string;
  naturalIdentifier: string;
  pointInTime?: string;
  version?: string;
  language?: string;
  pointInTimeManifestation?: string;
  subtype?: string;
}

export class EliParseError extends Error {
  constructor(input: string, reason: string) {
    super(`Not a valid ELI: ${input}\n  ${reason}`);
    this.name = "EliParseError";
  }
}

const KNOWN_EXTENSIONS = ["html", "xml", "zip", "pdf", "jpg", "gif"];

/**
 * Normalises the many shapes an ELI arrives in. Accepts a bare ELI, an
 * `eli/`-prefixed one, a full API path (`/v1/legislation/eli/…`), a portal path
 * (`/gesetze/eli/…`), or an absolute URL — so a value copied out of a browser or
 * an API response can be pasted directly.
 */
export function normalizeEliInput(input: string): string {
  let value = input.trim();

  if (/^https?:\/\//i.test(value)) {
    try {
      value = new URL(value).pathname;
    } catch {
      // Fall through and treat it as a plain path.
    }
  }

  value = value
    .replace(/^\/?v1\/legislation\//, "")
    .replace(/^\/?gesetze\//, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/^eli\//, "");

  // Drop a trailing format extension, but only a known one: `regelungstext-1`
  // contains no dot, whereas `image.jpg` does and must keep its name intact.
  const lastSlash = value.lastIndexOf("/");
  const lastSegment = value.slice(lastSlash + 1);
  const dot = lastSegment.lastIndexOf(".");
  if (dot > 0 && KNOWN_EXTENSIONS.includes(lastSegment.slice(dot + 1).toLowerCase())) {
    value = value.slice(0, lastSlash + 1) + lastSegment.slice(0, dot);
  }

  return value;
}

const LEVEL_BY_SEGMENT_COUNT: Record<number, EliLevel> = {
  4: "work",
  7: "expression",
  8: "manifestation-date",
  9: "manifestation",
};

export function parseEli(input: string): ParsedEli {
  const normalized = normalizeEliInput(input);
  const segments = normalized.split("/").filter(Boolean);
  const level = LEVEL_BY_SEGMENT_COUNT[segments.length];

  if (!level) {
    throw new EliParseError(
      input,
      `Expected 4 (work), 7 (expression), 8 (manifestation date) or 9 (manifestation) segments, got ${segments.length}.`,
    );
  }

  const [
    jurisdiction,
    agent,
    year,
    naturalIdentifier,
    pointInTime,
    version,
    language,
    pointInTimeManifestation,
    subtype,
  ] = segments as [string, string, string, string, ...(string | undefined)[]];

  if (level !== "work" && !/^\d{4}-\d{2}-\d{2}$/.test(pointInTime ?? "")) {
    throw new EliParseError(input, `Expected a YYYY-MM-DD point in time, got "${pointInTime}".`);
  }

  return {
    level,
    jurisdiction,
    agent,
    year,
    naturalIdentifier,
    pointInTime,
    version,
    language,
    pointInTimeManifestation,
    subtype,
  };
}

/** True when the input looks like an ELI rather than an abbreviation such as `BGB`. */
export function isEliLike(input: string): boolean {
  const normalized = normalizeEliInput(input);
  const count = normalized.split("/").filter(Boolean).length;
  return count in LEVEL_BY_SEGMENT_COUNT;
}

export function workPath(eli: ParsedEli): string {
  return [eli.jurisdiction, eli.agent, eli.year, eli.naturalIdentifier].join("/");
}

export function expressionPath(eli: ParsedEli): string {
  if (eli.level === "work") {
    throw new Error(
      "A work-level ELI has no expression path; it is missing date/version/language.",
    );
  }
  return [workPath(eli), eli.pointInTime, eli.version, eli.language].join("/");
}

/** The expression path plus the manifestation date — what `.zip` and resources address. */
export function manifestationDatePath(eli: ParsedEli): string {
  if (!eli.pointInTimeManifestation) {
    throw new Error("ELI has no manifestation date.");
  }
  return [expressionPath(eli), eli.pointInTimeManifestation].join("/");
}

export function manifestationPath(eli: ParsedEli): string {
  if (!eli.subtype) {
    throw new Error("ELI has no subtype (e.g. regelungstext-1).");
  }
  return [manifestationDatePath(eli), eli.subtype].join("/");
}

export function formatEli(eli: ParsedEli): string {
  switch (eli.level) {
    case "work":
      return `eli/${workPath(eli)}`;
    case "expression":
      return `eli/${expressionPath(eli)}`;
    case "manifestation-date":
      return `eli/${manifestationDatePath(eli)}`;
    case "manifestation":
      return `eli/${manifestationPath(eli)}`;
  }
}
