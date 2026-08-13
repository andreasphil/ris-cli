/**
 * The agent skill installed by `ris skill install`.
 *
 * Only the prose is written by hand. The command surface is walked out of the
 * citty definitions, so the skill cannot drift from the CLI: adding a command or a
 * flag and re-running `ris skill update` is enough.
 */
import { join } from "node:path";
import { globalArgs, searchArgs } from "./shared.ts";
import { describeArgs, type CommandNode, type FlagSpec } from "./tree.ts";

export const SKILL_NAME = "ris-cli";
export const DEFAULT_SKILL_DIR = join(".claude", "skills");

/** Where the skill lives inside a skills directory: `<target>/ris-cli/SKILL.md`. */
export function skillFilePath(targetDir: string): string {
  return join(targetDir, SKILL_NAME, "SKILL.md");
}

const GLOBAL_FLAGS = describeArgs(globalArgs).flags;
const SEARCH_FLAGS = describeArgs(searchArgs).flags;
const GLOBAL_NAMES = new Set(GLOBAL_FLAGS.map((flag) => flag.name));
const SEARCH_NAMES = new Set(SEARCH_FLAGS.map((flag) => flag.name));

/** `--court <name>`, `--output=json|table|…`, `--verbose, -v`. */
function renderFlag(flag: FlagSpec): string {
  const names = [`--${flag.name}`, ...flag.shortAliases.map((alias) => `-${alias}`)].join(", ");
  if (!flag.takesValue) return `\`${names}\``;
  if (flag.options && flag.options.length > 0) return `\`${names}=${flag.options.join("|")}\``;
  return `\`${names} <${flag.valueHint ?? "value"}>\``;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** `ris legislation article <eli> <articleEid>` */
function usage(path: string[], node: CommandNode): string {
  const positionals = node.positionals.map((positional) =>
    positional.required ? `<${positional.name}>` : `[${positional.name}]`,
  );
  return ["ris", ...path, ...positionals].join(" ");
}

/**
 * The flags that are specific to this command. Flags every command shares are
 * documented once at the top; the search/pagination block is named rather than
 * repeated across the dozen commands that take it.
 */
function specificFlags(node: CommandNode): string[] {
  const own = node.flags.filter((flag) => !GLOBAL_NAMES.has(flag.name));
  const takesSearchBlock = SEARCH_FLAGS.every((search) =>
    own.some((flag) => flag.name === search.name),
  );
  const rendered = own
    .filter((flag) => !(takesSearchBlock && SEARCH_NAMES.has(flag.name)))
    .map(renderFlag);
  return takesSearchBlock ? [...rendered, "search flags"] : rendered;
}

function renderLeaf(path: string[], node: CommandNode): string {
  const lines = [`- \`${usage(path, node)}\` — ${oneLine(node.description)}`];
  const flags = specificFlags(node);
  if (flags.length > 0) lines.push(`  Flags: ${flags.join(", ")}`);
  return lines.join("\n");
}

/** ``### `ris case-law` (cl) — Court decisions`` */
function groupHeading(node: CommandNode, path: string[], depth: number): string {
  const hashes = "#".repeat(Math.min(3 + depth, 6));
  const aliases = node.aliases.length > 0 ? ` (${node.aliases.join(", ")})` : "";
  return `${hashes} \`ris ${path.join(" ")}\`${aliases} — ${oneLine(node.description)}`;
}

/**
 * Leaf commands as a flat list, one `###` section per command group, so a path
 * like `ris case-law search` is always spelled out in full and can be copied.
 */
function renderTree(root: CommandNode): string {
  const sections: string[] = [];

  const leaves = root.subCommands.filter((child) => child.subCommands.length === 0);
  if (leaves.length > 0) {
    sections.push(
      `### Top level\n\n${leaves.map((child) => renderLeaf([child.name], child)).join("\n")}`,
    );
  }

  const renderGroup = (node: CommandNode, path: string[], depth: number): void => {
    const children = node.subCommands.filter((child) => child.subCommands.length === 0);
    sections.push(
      `${groupHeading(node, path, depth)}\n\n` +
        children.map((child) => renderLeaf([...path, child.name], child)).join("\n"),
    );
    for (const child of node.subCommands) {
      if (child.subCommands.length > 0) renderGroup(child, [...path, child.name], depth + 1);
    }
  };

  for (const child of root.subCommands) {
    if (child.subCommands.length > 0) renderGroup(child, [child.name], 0);
  }

  return sections.join("\n\n");
}

function renderFlagList(flags: FlagSpec[]): string {
  return flags.map((flag) => `- ${renderFlag(flag)} — ${oneLine(flag.description)}`).join("\n");
}

/** Renders the whole SKILL.md, including its YAML frontmatter. */
export function generateSkill(root: CommandNode, version: string): string {
  return `---
name: ${SKILL_NAME}
description: >-
  Query German federal law with the \`ris\` command line client for the RIS API
  (rechtsinformationen.bund.de) — legislation (Gesetze), court decisions
  (Rechtsprechung), legal literature and administrative directives. Use when a task
  needs the text, metadata, XML or HTML of a German federal law or court ruling,
  when resolving an ELI or a law abbreviation such as BGB or IVSG, when searching
  case law by court, file number or ECLI, or whenever a \`ris\` command appears in
  the conversation.
---

# ris — command line client for the RIS API

\`ris\` queries the RIS API (rechtsinformationen.bund.de): German federal
legislation, court decisions, literature and administrative directives. It exists so
you do not have to remember endpoint paths, assemble nine-segment ELIs by hand, or
retype base URLs and credentials.

Every API endpoint behind this CLI is a GET. Nothing you run through \`ris\` can
change legal data — the only commands that write anything are \`ris config set\`,
\`ris config use\` and \`ris skill install/update\`, which touch local files.

## Rules

- **Never switch or edit the user's profile.** Do not run \`ris config use\` or
  \`ris config set\`, and do not edit \`~/.config/ris-cli/config.json\`. Which
  environment is the default is the user's decision, and changing it silently
  redirects every later command — including the user's own. \`ris config list\`,
  \`ris config show\`, \`ris config path\` and \`ris config check\` are read-only and
  fine to run.
- **Need a different environment? Do it per command.** Pass \`--profile <name>\` on
  that one invocation, and say in your answer which one you used. If the user seems
  to want a different default, tell them the command (\`ris config use <name>\`) and
  let them run it.
- **Never put a secret on the command line.** Credentials come only from the
  profile, as 1Password references — there is no flag and no environment variable
  that takes one. Do not echo credentials into your answer, and do not write them to
  a file.
- **Diagnose connection failures, do not work around them.** The fallback target is
  \`http://localhost:8080\`, so "connection refused" usually means no default profile
  is set and no local backend is running. Report that and suggest
  \`--profile testphase\` for a public instance — do not change the default.
- **Keep result sets small.** Each command fetches one page. Prefer \`--size\` with a
  small number while exploring, and page through with \`--page\` only if you must.
- **Check before you claim.** If a command exits non-zero, say so and show the
  error; do not present a guessed document number, ELI or citation as if it came
  from the API.

## Concepts

### Four document kinds, one set of verbs

\`case-law\` (\`cl\`), \`legislation\` (\`leg\`), \`literature\` (\`lit\`) and
\`directive\` (\`ad\`) all support \`search\`, \`lucene\`, \`get\`, \`xml\`, \`html\`
and \`changelog\`; legislation and case law add a few of their own. Learning one
kind teaches the other three. \`ris search\` and \`ris lucene\` search across all
four at once.

### Where flags go

Flags belong to the command they follow, so put them after the full subcommand
path: \`ris leg toc IVSG --profile testphase\`, **not**
\`ris --profile testphase leg toc IVSG\` — the latter fails with
"Unknown command testphase".

### Which API gets queried

Profiles are the only source of URLs and credentials. \`--profile <name>\` picks one
for a single command; otherwise the config file's default profile applies, falling
back to \`http://localhost:8080\` when none is set. Built-in profiles are \`local\`,
\`staging\` and \`testphase\`. \`ris config list\` shows what is configured and which
is the default; \`ris config check\` verifies that a profile's URL and credentials
actually work.

### Addressing a document

- **Case law, literature, directives:** a document number, e.g. \`STRE201770751\`.
- **Legislation:** an ELI at work, expression or manifestation level, with or
  without the \`eli/\` prefix, or a URL pasted from the browser or an API response —
  all are accepted anywhere an ELI is taken.
- **Legislation by name:** a non-ELI argument is resolved as an abbreviation
  (\`ris leg html IVSG\`), picking the version most relevant today. Override the
  date with \`--on-date YYYY-MM-DD\`.
- \`ris legislation versions\` lists every expression of a law; \`ris legislation toc\`
  lists article eIds, which is where the argument for \`ris legislation article\`
  comes from.

### Output

- \`-o json|table\` — a table on a terminal, JSON when piped. Piping into \`jq\`
  therefore already gives you JSON; use it to pull out single values.
- Tables unwrap the Hydra envelope, so rows are documents rather than
  \`member[].item\` nesting. JSON keeps the envelope, so \`view.next\` and
  \`totalItems\` tell you whether more pages exist.
- Everything goes to stdout, so the shell decides where it lands: redirect with
  \`> file\` to save XML, HTML or a ZIP. Binary commands (\`zip\`, \`resource\`) refuse
  to run into a bare terminal, so always redirect or pipe those.
- Diagnostics — row counts, pagination hints, \`No results.\` — go to stderr, so
  stdout stays pipeable and empty when there is nothing to report.
- \`--dry-run\` prints the equivalent \`curl\` command instead of sending it — useful
  to show the user what a command would do.

### Filters

Search flags combine as AND. Multi-value filters — \`--type\`, \`--type-group\` — may
be repeated or given as one comma-separated value; both mean the same thing. Dates
are \`YYYY-MM-DD\`. When a plain search returns too much, reach for \`lucene\`, which
takes field queries such as \`courtName:"BGH Karlsruhe" AND date:[2020 TO 2024]\`.

### Exit codes

\`0\` success · \`1\` the CLI could not run (bad flags, unreachable host) · \`2\` the
API rejected the request (404, 422, …). Diagnostics go to stderr, data to stdout.

## Command surface

Run \`ris <command> --help\` for the full description of any command and its flags.

### Global flags

Accepted by every command that talks to the API:

${renderFlagList(GLOBAL_FLAGS)}

### Search flags

Listed below as "search flags" wherever a command accepts them:

${renderFlagList(SEARCH_FLAGS)}

${renderTree(root)}

## Recipes

\`\`\`sh
ris stats                                   # document counts per kind
ris search "Mietrecht Kündigung" --size 5   # across all kinds
ris case-law search --court BGH --from 2024-01-01 --size 5
ris cl lucene 'courtName:"BGH Karlsruhe" AND date:[2020 TO 2024]'
ris cl get STRE201770751 | jq -r .headline  # one field of one decision
ris leg html IVSG                           # current consolidated text
ris leg toc IVSG                            # article eIds
ris leg article IVSG hauptteil-1_art-1      # one article; eId comes from \`toc\`
ris cl changelog --from 2026-01-01          # what changed since then
ris cl courts BGH                           # courts matching a prefix
\`\`\`

---

Generated from ris ${version} by \`ris skill install\`. After upgrading the CLI, run
\`ris skill update\` to regenerate this file — do not edit it by hand.
`;
}
