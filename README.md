<h1 align="center">
  RIS CLI 🔖
</h1>

<p align="center">
  <strong>CLI for the <a href="https://docs.rechtsinformationen.bund.de/">NeuRIS Portal API</a></strong>
</p>

- 🔍 Search legislation, court decisions, literature and directives — by court, ECLI, date or Lucene
- 📜 ELIs made bearable: work, expression, manifestation, a pasted URL, or just a law's abbreviation
- 🔐 Profiles for local, staging and testphase, with credentials as 1Password references
- 🧰 A table on a terminal, JSON when piped, NDJSON for bulk, `--dry-run` to see the `curl`
- 🤖 An agent skill, generated from the CLI itself so it never drifts

> [!NOTE]
>
> An unofficial, personal side project. It is not a product of, affiliated with, or
> supported by the NeuRIS project or the institutions behind
> [rechtsinformationen.bund.de](https://rechtsinformationen.bund.de), and it only
> reads from the public API.

> [!CAUTION]
>
> Entirely vibe coded and poorly tested 😬

## Installation

Requires [Node](https://nodejs.org) 26 or newer (the CLI runs TypeScript directly)
and [pnpm](https://pnpm.io) 11 or newer. Storing credentials as 1Password references
additionally needs the [1Password CLI](https://developer.1password.com/docs/cli/)
(`brew install 1password-cli`).

```sh
git clone git@github.com:andreasphil/ris-cli.git
cd ris-cli
pnpm install
pnpm build
pnpm link --global   # puts `ris` on your PATH
```

Instead of linking, you can symlink the binary into a directory you already have on
your `PATH`:

```sh
ln -s "$PWD/bin/ris.mjs" ~/.local/bin/ris
```

Either way, check it with `ris stats`. Without installing at all, the CLI runs as
`node bin/ris.mjs …` or `pnpm dev …`.

### Uninstalling

```sh
pnpm unlink --global            # or: rm ~/.local/bin/ris
rm -rf ~/.config/ris-cli        # profiles and default (no secrets are stored here)
```

Then delete the clone.

## Usage

Every document kind supports the same verbs, so learning one teaches all four:

```
ris search <terms…>              across all document kinds
ris lucene <query>               Lucene syntax, all kinds
ris stats                        document counts
ris bulk-links                   bulk ZIP download URLs
ris raw <path> --param k=v       any endpoint, with URL/auth/output handled

ris case-law    (cl)   search · lucene · get · xml · html · zip · resource · courts · changelog
ris legislation (leg)  search · lucene · get · versions · toc · xml · html · article ·
                       zip · resource · translations · changelog
ris literature  (lit)  search · lucene · get · xml · html · changelog
ris directive   (ad)   search · lucene · get · xml · html · changelog

ris config             list · show · set · use · path · check
ris skill              install · update
```

```console
$ ris stats
legislation                2,415
case-law                  83,695
literature                     0
administrative-directive       0
                          ------
total                     86,110

$ ris case-law search --court BGH --size 3
DOCUMENT NUMBER  DATE        COURT   TYPE       TITLE
KORE300462026    2026-07-30  BGH     Urteil     BGH, Urteil vom 30. Juli 2026 - I ZR 130/25
KORE601422026    2026-07-29  BGH     Beschluss  BGH, Beschluss vom 29. Juli 2026 - V ZR 205/25
…
```

`ris --help` lists every command, and `ris <command> --help` explains one of them —
including flags, which belong to the command they follow (`ris cl search --court BGH`,
not `ris --court BGH cl search`).

### Profiles, config and authentication

Profiles are the only source of URLs and credentials — there are no environment
variables and no per-request auth flags. `--profile <name>` picks one for a single
command; otherwise the config file's default profile applies, falling back to
`http://localhost:8080` when none is set.

Three profiles are built in — `local`, `staging`, `testphase` — and you can add your
own. Config lives at `$XDG_CONFIG_HOME/ris-cli/config.json`
(`~/.config/ris-cli/config.json`).

```sh
ris config list                 # show profiles and which is the default
ris config set prod --url https://…
ris config use testphase        # set the default
ris config check                # verify the URL and credentials actually work
ris config path                 # where the config file lives
```

The API is protected two different ways, at two different layers, and they compose:
HTTP Basic at the ingress (staging), and an `X-Api-Key` header in the application
(the `production` Spring profile).

**Credentials are never written to the config file.** Store a 1Password secret
reference instead; it is resolved with `op read` at request time:

```sh
ris config set staging \
  --url https://ris-portal-staging.dev.tech.digitalservice.dev \
  --user my.name@digitalservice.bund.de \
  --password-ref "op://Employee/ris-staging/password"

ris config set prod --url https://… --api-key-ref "op://Employee/ris-api-key/credential"
```

There is deliberately no way to pass a credential per request — no `--password`
flag, which would land in your shell history, and no environment variables. If a
command needs credentials, they belong on a profile.

### Legislation and ELIs

Anywhere an ELI is accepted, you can pass a work, expression or manifestation ELI —
with or without an `eli/` prefix, or a URL pasted from the browser or an API
response. A non-ELI argument is resolved by abbreviation, picking the version most
relevant today (override with `--on-date`):

```sh
ris leg html IVSG                    # current consolidated text
ris leg html IVSG --on-date 2020-01-01
ris leg toc IVSG                     # article eIds, for `ris leg article`
ris leg get eli/bund/bgbl-1/2026/148/2026-05-15/1/deu
```

### Output

- `-o json|table|ndjson|raw` — defaults to a table on a terminal, JSON when piped.
- Tables unwrap the Hydra envelope, so you see documents rather than
  `member[].item` nesting.
- `-f, --field <path>` extracts a value: `-f view.next`,
  `-f member[0].item.documentNumber`.
- `--all` follows every page and emits NDJSON, throttled under the API's
  600 requests/minute limit.
- `--dry-run` prints the equivalent `curl` command instead of sending it, with
  credentials shown as placeholders so nothing secret is written to your scrollback.
- `-O, --output-file` writes bodies and binaries to a file (`-` for stdout).

Exit codes: `0` success, `1` the CLI could not run (bad flags, unreachable host),
`2` the API rejected the request (404, 422, …).

### Agent skill

`ris skill install` writes a usage guide for coding agents to
`./.claude/skills/ris-cli/SKILL.md`:

```sh
ris skill install                              # ./.claude/skills/ris-cli/SKILL.md
ris skill install --target ~/.claude/skills    # anywhere else
ris skill update                               # regenerate after upgrading
```

`install` refuses to overwrite an existing file; `update` replaces it. The command
surface in the skill is walked out of the command definitions, so a new command or
flag only needs an `update`, never hand-editing. The skill also tells the agent to
leave your profile alone: no `config use`, no `config set`, `--profile` per command
instead.

## Development

The CLI is written in [TypeScript](https://www.typescriptlang.org) and run directly
by Node, without a build step in development. Everything is a
[pnpm](https://pnpm.io) script:

```sh
pnpm dev …            # run the CLI from source, e.g. pnpm dev stats
pnpm test             # run tests (pnpm test:watch to keep them running)
pnpm typecheck        # tsc --noEmit
pnpm style:check      # formatting and lints (pnpm style:fix to apply)
pnpm build            # compile to dist/, which bin/ris.mjs loads
pnpm sync-spec        # refresh spec/openapi.json and regenerate API types
```

`pnpm sync-spec` prefers a backend running on `localhost:8080` and falls back to the
published spec. Note that neither source includes the backend's `@Hidden` endpoints
(`work-example`, `translatedLegislation`), which this CLI uses anyway.

## Credits

This app uses a number of open source packages listed in [package.json](./package.json).

Thanks 🙏
