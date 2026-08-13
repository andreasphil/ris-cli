import type { Target } from "./config.ts";

/** Backend default is 600 requests/minute (`rate-limit` in application.yaml). */
const REQUESTS_PER_MINUTE = 600;
const MIN_REQUEST_SPACING_MS = Math.ceil(60_000 / REQUESTS_PER_MINUTE);

export type QueryValue = string | number | boolean | string[] | undefined | null;
export type Query = Record<string, QueryValue>;

export interface RequestSpec {
  path: string;
  query?: Query;
  accept?: string;
  /**
   * Internal requests (abbreviation lookups, expression→manifestation resolution)
   * run even under --dry-run, so that the *final* URL printed is the real one.
   */
  internal?: boolean;
}

export interface ClientOptions {
  target: Target;
  dryRun?: boolean;
  verbose?: boolean;
  timeoutMs?: number;
}

/** Thrown to unwind out of a command once --dry-run has printed the request. */
export class DryRunComplete extends Error {
  constructor() {
    super("dry run");
    this.name = "DryRunComplete";
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: string;

  constructor(status: number, url: string, body: string) {
    super(ApiError.describe(status, url, body));
    this.name = "ApiError";
    this.status = status;
    this.url = url;
    this.body = body;
  }

  private static describe(status: number, url: string, body: string): string {
    const base = `HTTP ${status} for ${url}`;
    switch (status) {
      case 401:
      case 403:
        return (
          `${base}\n  This environment requires authentication. Store credentials on the ` +
          `profile with \`ris config set\`, then check them with \`ris config check\`.`
        );
      case 404:
        return `${base}\n  Not found. Check the document number or ELI.`;
      case 422:
        return `${base}\n  The API rejected a parameter.${body ? `\n  ${truncate(body, 400)}` : ""}`;
      case 429:
        return `${base}\n  Rate limited (the API allows ${REQUESTS_PER_MINUTE} requests/minute).`;
      default:
        return body ? `${base}\n  ${truncate(body, 400)}` : base;
    }
  }
}

function truncate(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

export function buildUrl(baseUrl: string, path: string, query: Query = {}): string {
  const url = new URL(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    // The API accepts repeated parameters for array-valued filters.
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry !== undefined && entry !== null && entry !== "") {
          url.searchParams.append(key, String(entry));
        }
      }
    } else {
      url.searchParams.append(key, String(value));
    }
  }
  return url.toString();
}

/**
 * The equivalent curl command. Credentials are emitted as placeholders to be
 * filled in, so no secret is ever written to a terminal, a scrollback buffer or a
 * shell history file.
 */
export function toCurl(url: string, headers: Record<string, string>, accept?: string): string {
  const parts = ["curl", "-sS"];
  if (accept) parts.push("-H", quote(`Accept: ${accept}`));
  if (headers.Authorization) parts.push("-u", quote("<username>:<password>"));
  if (headers["X-Api-Key"]) parts.push("-H", quote("X-Api-Key: <api-key>"));
  parts.push(quote(url));
  return parts.join(" ");
}

function quote(value: string): string {
  return /[^\w@%+=:,./-]/.test(value) ? `'${value.replace(/'/g, `'\\''`)}'` : value;
}

export class RisClient {
  private lastRequestAt = 0;
  private readonly options: ClientOptions;

  constructor(options: ClientOptions) {
    this.options = options;
  }

  get baseUrl(): string {
    return this.options.target.url;
  }

  async fetch(spec: RequestSpec): Promise<Response> {
    const url = buildUrl(this.baseUrl, spec.path, spec.query);
    const headers: Record<string, string> = { ...this.options.target.headers };
    if (spec.accept) headers.Accept = spec.accept;

    if (this.options.dryRun && !spec.internal) {
      process.stdout.write(`${toCurl(url, headers, spec.accept)}\n`);
      throw new DryRunComplete();
    }

    await this.throttle();

    const startedAt = performance.now();
    let response: Response;
    try {
      response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new Error(`Request to ${url} timed out.`);
      }
      throw new Error(
        `Cannot reach ${this.baseUrl}: ${(error as Error).message}\n` +
          `  Is the backend running, and is the URL right? Check with: ris config list`,
      );
    }

    if (this.options.verbose) {
      const ms = Math.round(performance.now() - startedAt);
      process.stderr.write(`GET ${url} → ${response.status} (${ms}ms)\n`);
    }

    if (!response.ok) {
      throw new ApiError(response.status, url, await response.text().catch(() => ""));
    }
    return response;
  }

  async json<T>(spec: RequestSpec): Promise<T> {
    // Changelog endpoints declare `*/*` rather than application/json, so we ask
    // for JSON explicitly rather than trusting the declared content type.
    const response = await this.fetch({ accept: "application/json", ...spec });
    return (await response.json()) as T;
  }

  async text(spec: RequestSpec): Promise<string> {
    return (await this.fetch(spec)).text();
  }

  async bytes(spec: RequestSpec): Promise<{ data: Uint8Array; filename?: string }> {
    const response = await this.fetch(spec);
    const disposition = response.headers.get("content-disposition") ?? "";
    const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    return {
      data: new Uint8Array(await response.arrayBuffer()),
      filename: match?.[1],
    };
  }

  /** Spaces requests so a scripted loop cannot trip the API's rate limit. */
  private async throttle(): Promise<void> {
    const waitMs = this.lastRequestAt + MIN_REQUEST_SPACING_MS - Date.now();
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.lastRequestAt = Date.now();
  }
}
