# ris-cli

A command line client for the [RIS API](https://testphase.rechtsinformationen.bund.de) —
German federal legislation, court decisions, literature and administrative directives.

Written so you don't have to remember endpoint paths, assemble nine-segment ELIs by
hand, or retype base URLs and credentials for local, staging and production.

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

$ ris legislation html IVSG          # abbreviation → current consolidated text
$ ris legislation toc IVSG           # article eIds, for `ris legislation article`
```

## Install

Requires Node 26+ and pnpm.

```sh
pnpm install
pnpm build
pnpm link --global   # puts `ris` on your PATH
```

Without linking, run it as `node bin/ris.mjs …` or `pnpm dev …`.

## Choosing an environment

Resolution order, highest first:

1. `--api-url https://…`
2. `--profile <name>`
3. `$RIS_API_URL`
4. the config file's default profile
5. `http://localhost:8090`

Three profiles are built in — `local`, `staging`, `testphase` — and you can add your
own:

```sh
ris config list                 # show profiles and which is the default
ris config set prod --url https://…
ris config use testphase        # set the default
ris config check                # verify the URL and credentials actually work
ris config path                 # where the config file lives
```

Config is at `$XDG_CONFIG_HOME/ris-cli/config.json` (`~/.config/ris-cli/config.json`).

## Authentication

The API is protected two different ways, at two different layers, and they compose:

| Layer       | Mechanism          | Where it applies                |
| ----------- | ------------------ | ------------------------------- |
| Ingress     | HTTP Basic         | staging                         |
| Application | `X-Api-Key` header | the `production` Spring profile |

**Credentials are never written to the config file.** Store a 1Password secret
reference instead; it is resolved with `op read` at request time:

```sh
ris config set staging \
  --url https://ris-portal-staging.dev.tech.digitalservice.dev \
  --user my.name@digitalservice.bund.de \
  --password-ref "op://Employee/ris-staging/password"

ris config set prod --url https://… --api-key-ref "op://Employee/ris-api-key/credential"
```

This requires the [1Password CLI](https://developer.1password.com/docs/cli/)
(`brew install 1password-cli`). For CI and one-offs there are also
`$RIS_BASIC_USER` / `$RIS_BASIC_PASSWORD` / `$RIS_API_KEY`, plus `--user` with
`--password-stdin`. There is deliberately no `--password` flag — it would land in
your shell history.

## Commands

Every document kind supports the same verbs, so learning one teaches all four.

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
ris completion <shell> bash · zsh · fish
```

### Shell completion

```sh
# bash — add to ~/.bashrc
eval "$(ris completion bash)"

# zsh — first entry of $fpath, then restart the shell
ris completion zsh > "${fpath[1]}/_ris"

# fish
ris completion fish > ~/.config/fish/completions/ris.fish
```

Completes commands, aliases, flags, and flag values — including `--output`,
`--legal-effect` and `--type-group`. `--profile` completes against the profiles you
have actually configured. Leaf positionals that are free text (search terms,
document numbers, ELIs) deliberately complete to nothing rather than to a
misleading file listing; `-O/--output-file` completes filenames.

### Legislation: ELIs made bearable

Anywhere an ELI is accepted, you can pass a work, expression or manifestation ELI —
with or without an `eli/` prefix, or a URL pasted from the browser or an API
response:

```sh
ris leg get     eli/bund/bgbl-1/2026/148/2026-05-15/1/deu
ris leg html    https://testphase.rechtsinformationen.bund.de/v1/legislation/eli/bund/…
```

You can also just name the law. A non-ELI argument is resolved by abbreviation,
picking the version most relevant today (override with `--on-date`):

```sh
ris leg html IVSG
ris leg html IVSG --on-date 2020-01-01
```

Given an expression ELI, `html`/`xml`/`zip` find the manifestation by reading the
document's own `encoding` list rather than guessing — subtypes are not predictable
(`regelungstext-verkuendung-1`, not always `regelungstext-1`).

## Output

- `-o json|table|ndjson|raw` — defaults to a table on a terminal, JSON when piped.
- Tables unwrap the Hydra envelope, so you see documents rather than
  `member[].item` nesting.
- `-f, --field <path>` extracts a value: `-f view.next`, `-f member[0].item.documentNumber`.
- `--all` follows every page and emits NDJSON, throttled under the API's
  600 requests/minute limit.
- `--dry-run` prints the equivalent `curl` command instead of sending it, with
  credentials shown as shell variable references so nothing secret is written to
  your scrollback.
- `-O, --output-file` writes bodies and binaries to a file (`-` for stdout).

Exit codes: `0` success, `1` the CLI could not run (bad flags, unreachable host),
`2` the API rejected the request (404, 422, …).

## Development

```sh
pnpm typecheck && pnpm test && pnpm style:check
pnpm sync-spec        # refresh spec/openapi.json + regenerate types
```

`pnpm sync-spec` prefers a backend running on `localhost:8090` and falls back to the
published spec. Note that neither source includes the backend's `@Hidden` endpoints
(`work-example`, `translatedLegislation`), which this CLI uses anyway.
