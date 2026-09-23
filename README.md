<h1 align="center">
  RIS CLI 🔖
</h1>

<p align="center">
  <strong>CLI for the <a href="https://docs.rechtsinformationen.bund.de/">NeuRIS Portal API</a></strong>
</p>

- 🔍 Search legislation, court decisions, literature and directives by court, ECLI, date, or Lucene
- 📜 ELIs made bearable: work, expression, manifestation, a pasted URL, or just a law's abbreviation
- 🔐 Profiles for local, staging and testphase, with credentials as 1Password references
- 🧰 A table on a terminal, JSON when piped, `--dry-run` to see the `curl`
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

![Screenshot](./screenshot.png)

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
rm -rf ~/.config/ris-cli        # profiles and default
```

Then delete the clone.

## Usage

`ris --help` lists every command, and `ris <command> --help` explains one of them,
including flags. Flags belong to the command they follow (`ris cl search --court BGH`,
not `ris --court BGH cl search`).

### Profiles and credentials

A profile holds the API URL and, optionally, credentials. `--profile <name>` picks
one for a single command; otherwise the config file's default profile applies,
falling back to `http://localhost:8080`.

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

Credentials live in 1Password rather than in the config file: store a secret
reference and it is resolved with `op read` at request time.

```sh
ris config set staging \
  --url https://ris-portal-staging.dev.tech.digitalservice.dev \
  --user my.name@digitalservice.bund.de \
  --password-ref "op://Employee/ris-staging/password"

ris config set prod --url https://… --api-key-ref "op://Employee/ris-api-key/credential"
```

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
published spec. On top of what the spec declares, the CLI also reaches two `@Hidden`
endpoints — `work-example` (behind `ris leg versions`) and `translatedLegislation`
(behind `ris leg translations`).

## Credits

This app uses a number of open source packages listed in [package.json](./package.json).

Thanks 🙏
