import { defineCommand } from "citty";
import type { components } from "../types/api.d.ts";
import { RisClient } from "../client.ts";
import {
  BUILTIN_PROFILES,
  configPath,
  isSecretRef,
  knownProfileNames,
  loadConfig,
  resolveProfile,
  resolveTarget,
  saveConfig,
  type Profile,
} from "../config.ts";
import { globalArgsWithoutProfile } from "../shared.ts";

type StatisticsApiSchema = components["schemas"]["StatisticsApiSchema"];

function describeAuth(profile: Profile): string {
  const parts: string[] = [];
  if (profile.basic) parts.push(`basic (${profile.basic.username})`);
  if (profile.apiKey) parts.push(`api-key (${profile.apiKey})`);
  return parts.length > 0 ? parts.join(" + ") : "none";
}

const listCommand = defineCommand({
  meta: { name: "list", description: "Show all profiles and which one is the default" },
  async run() {
    const config = await loadConfig();
    const names = knownProfileNames(config);
    const rows = names.map((name) => {
      const profile = resolveProfile(config, name)!;
      const markers: string[] = [];
      if (name === config.defaultProfile) markers.push("default");
      if (!config.profiles[name]) markers.push("built-in");
      return {
        name: `${name}${markers.length > 0 ? ` (${markers.join(", ")})` : ""}`,
        url: profile.url,
        auth: describeAuth(profile),
      };
    });

    const nameWidth = Math.max(...rows.map((row) => row.name.length));
    const urlWidth = Math.max(...rows.map((row) => row.url.length));
    process.stdout.write(
      `${rows
        .map((row) => `${row.name.padEnd(nameWidth)}  ${row.url.padEnd(urlWidth)}  ${row.auth}`)
        .join("\n")}\n`,
    );
    if (!config.defaultProfile) {
      process.stderr.write(
        `\nNo default profile set; falling back to ${BUILTIN_PROFILES.local!.url}. ` +
          `Set one with: ris config use <name>\n`,
      );
    }
    process.stderr.write(`\nConfig: ${configPath()}\n`);
  },
});

const showCommand = defineCommand({
  meta: { name: "show", description: "Show one profile as JSON" },
  args: {
    profile: { type: "positional", description: "Profile name", required: false },
  },
  async run({ args }) {
    const config = await loadConfig();
    const name = args.profile ?? config.defaultProfile ?? "local";
    const profile = resolveProfile(config, name);
    if (!profile) {
      throw new Error(
        `Unknown profile "${name}". Known profiles: ${knownProfileNames(config).join(", ")}.`,
      );
    }
    process.stdout.write(`${JSON.stringify({ [name]: profile }, null, 2)}\n`);
  },
});

const setCommand = defineCommand({
  meta: {
    name: "set",
    description: "Create or update a profile (secrets are stored as 1Password references)",
  },
  args: {
    profile: { type: "positional", description: "Profile name", required: true },
    url: { type: "string", description: "Base URL of the API", valueHint: "url" },
    user: { type: "string", description: "Basic auth username, or an op:// reference" },
    "password-ref": {
      type: "string",
      description: "1Password reference for the Basic auth password, e.g. op://Vault/Item/password",
      valueHint: "op://…",
    },
    "api-key-ref": {
      type: "string",
      description: "1Password reference for the X-Api-Key value",
      valueHint: "op://…",
    },
    "clear-auth": { type: "boolean", description: "Remove all credentials from the profile" },
  },
  async run({ args }) {
    const config = await loadConfig();
    const name = args.profile;
    const existing = config.profiles[name] ?? resolveProfile(config, name);

    const url = asString(args.url) ?? existing?.url;
    if (!url) {
      throw new Error(`Profile "${name}" is new, so --url is required.`);
    }

    const profile: Profile = { url };
    if (!args["clear-auth"]) {
      const username = asString(args.user) ?? existing?.basic?.username;
      const password = asString(args["password-ref"]) ?? existing?.basic?.password;
      if (username && password) profile.basic = { username, password };
      else if (username || password) {
        throw new Error("Basic auth needs both --user and --password-ref.");
      }

      const apiKey = asString(args["api-key-ref"]) ?? existing?.apiKey;
      if (apiKey) profile.apiKey = apiKey;
    }

    for (const value of [profile.basic?.password, profile.apiKey]) {
      if (value && !isSecretRef(value)) {
        process.stderr.write(
          `Warning: "${value}" is stored literally in ${configPath()}.\n` +
            `  Prefer a 1Password reference (op://Vault/Item/field) so no secret is written to disk.\n`,
        );
      }
    }

    config.profiles[name] = profile;
    config.defaultProfile ??= name;
    await saveConfig(config);
    process.stdout.write(
      `Saved profile "${name}" → ${profile.url} (auth: ${describeAuth(profile)})\n`,
    );
  },
});

const useCommand = defineCommand({
  meta: { name: "use", description: "Set the default profile" },
  args: { profile: { type: "positional", description: "Profile name", required: true } },
  async run({ args }) {
    const config = await loadConfig();
    if (!resolveProfile(config, args.profile)) {
      throw new Error(
        `Unknown profile "${args.profile}". Known profiles: ${knownProfileNames(config).join(", ")}.`,
      );
    }
    // Materialise a built-in preset on first use so it can be edited later.
    config.profiles[args.profile] ??= { ...BUILTIN_PROFILES[args.profile]! };
    config.defaultProfile = args.profile;
    await saveConfig(config);
    process.stdout.write(`Default profile is now "${args.profile}".\n`);
  },
});

const pathCommand = defineCommand({
  meta: { name: "path", description: "Print the config file location" },
  run() {
    process.stdout.write(`${configPath()}\n`);
  },
});

const checkCommand = defineCommand({
  meta: {
    name: "check",
    description: "Verify that the resolved URL and credentials actually work",
  },
  args: {
    profile: { type: "positional", description: "Profile to check", required: false },
    ...globalArgsWithoutProfile,
  },
  async run({ args }) {
    const config = await loadConfig();
    const target = await resolveTarget(config, { profile: asString(args.profile) });

    const authDescription = [
      target.headers.Authorization ? "basic" : undefined,
      target.headers["X-Api-Key"] ? "api-key" : undefined,
    ]
      .filter(Boolean)
      .join(" + ");
    process.stderr.write(
      `Checking ${target.url}${target.profileName ? ` (profile: ${target.profileName})` : ""} ` +
        `with auth: ${authDescription || "none"}\n`,
    );

    const client = new RisClient({ target, verbose: args.verbose === true });
    const stats = await client.json<StatisticsApiSchema>({ path: "/v1/statistics" });
    const total = Object.values(stats).reduce((sum, value) => sum + (value?.count ?? 0), 0);
    process.stdout.write(`OK — reachable, ${total.toLocaleString("en-US")} documents indexed.\n`);
  },
});

export const configCommand = defineCommand({
  meta: { name: "config", description: "Manage API URLs and credentials" },
  subCommands: {
    list: listCommand,
    show: showCommand,
    set: setCommand,
    use: useCommand,
    path: pathCommand,
    check: checkCommand,
  },
});

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
