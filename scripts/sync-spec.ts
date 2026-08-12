/**
 * Refreshes the vendored OpenAPI spec and regenerates types.
 *
 * Prefers a locally running backend, whose springdoc-generated spec is the most
 * current, and falls back to the published one. Note that neither source includes
 * the backend's `@Hidden` endpoints — those are typed by hand in
 * src/types/internal.ts.
 */
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SOURCES = [
  "http://localhost:8080/v3/api-docs",
  "https://testphase.rechtsinformationen.bund.de/v3/api-docs",
];

const SPEC_PATH = "spec/openapi.json";

async function tryFetch(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      process.stderr.write(`  ${url} → HTTP ${response.status}\n`);
      return undefined;
    }
    return await response.text();
  } catch (error) {
    process.stderr.write(`  ${url} → ${(error as Error).message}\n`);
    return undefined;
  }
}

const explicit = process.argv.slice(2).find((arg) => !arg.startsWith("-"));
const candidates = explicit ? [explicit] : SOURCES;

let spec: string | undefined;
for (const url of candidates) {
  process.stderr.write(`Fetching ${url}\n`);
  spec = await tryFetch(url);
  if (spec) break;
}

if (!spec) {
  process.stderr.write(
    `\nCould not fetch the spec from any source. Start the backend on :8080, or pass a URL:\n` +
      `  pnpm sync-spec https://host/v3/api-docs\n`,
  );
  process.exit(1);
}

const parsed = JSON.parse(spec) as { paths?: Record<string, unknown> };
const pathCount = Object.keys(parsed.paths ?? {}).length;
if (pathCount === 0) {
  process.stderr.write("The fetched document has no paths — refusing to overwrite the spec.\n");
  process.exit(1);
}

await writeFile(SPEC_PATH, `${JSON.stringify(parsed, null, 2)}\n`);
process.stderr.write(`Wrote ${SPEC_PATH} (${pathCount} paths)\n`);

await execFileAsync("pnpm", ["generate-api-types"], { stdio: "inherit" } as never);
process.stderr.write("Regenerated src/types/api.d.ts\n");
