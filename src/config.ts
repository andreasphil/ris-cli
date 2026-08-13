import { execFile } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_API_URL = "http://localhost:8080";

/**
 * A secret is never stored in this file. It holds either a 1Password secret
 * reference (`op://vault/item/field`), resolved by shelling out to `op read` at
 * request time, or — for a value that is not actually secret, like a username —
 * a literal.
 */
export type SecretRef = string;

export interface Profile {
  url: string;
  /**
   * HTTP Basic credentials. Staging sits behind Basic auth at the ingress layer,
   * so this is orthogonal to `apiKey` and the two compose.
   */
  basic?: { username: SecretRef; password: SecretRef };
  /** `X-Api-Key` header value (`prefix` + secret), required by the production profile. */
  apiKey?: SecretRef;
}

export interface Config {
  defaultProfile?: string;
  profiles: Record<string, Profile>;
}

export const BUILTIN_PROFILES: Record<string, Profile> = {
  local: { url: DEFAULT_API_URL },
  staging: { url: "https://ris-portal-staging.dev.tech.digitalservice.dev" },
  testphase: { url: "https://testphase.rechtsinformationen.bund.de" },
};

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config");
  return join(base, "ris-cli", "config.json");
}

export async function loadConfig(path = configPath()): Promise<Config> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<Config>;
    return { defaultProfile: parsed.defaultProfile, profiles: parsed.profiles ?? {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { profiles: {} };
    if (error instanceof SyntaxError) {
      throw new Error(`Config file at ${path} is not valid JSON: ${error.message}`);
    }
    throw error;
  }
}

export async function saveConfig(config: Config, path = configPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

/** Profiles from the config file, falling back to the built-in presets. */
export function resolveProfile(config: Config, name: string): Profile | undefined {
  return config.profiles[name] ?? BUILTIN_PROFILES[name];
}

export function knownProfileNames(config: Config): string[] {
  return [...new Set([...Object.keys(BUILTIN_PROFILES), ...Object.keys(config.profiles)])].sort();
}

export function isSecretRef(value: string): boolean {
  return value.startsWith("op://");
}

/** Resolves an `op://` reference via the 1Password CLI; passes literals through. */
export async function resolveSecret(value: SecretRef): Promise<string> {
  if (!isSecretRef(value)) return value;

  try {
    const { stdout } = await execFileAsync("op", ["read", "--no-newline", value]);
    return stdout;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Cannot resolve ${value}: the 1Password CLI (op) is not installed.\n` +
          `  Install it with \`brew install 1password-cli\`.`,
      );
    }
    throw new Error(`Cannot resolve ${value} via 1Password: ${stderr || (error as Error).message}`);
  }
}

export interface Target {
  url: string;
  /** Which profile the URL came from, for error messages. */
  profileName?: string;
  headers: Record<string, string>;
}

/**
 * Resolves base URL and auth headers from a profile — the only place either comes
 * from. An explicit name picks one; otherwise the config file's default profile
 * applies, falling back to localhost when none is set.
 *
 * Basic and API key compose, because they are enforced at different layers
 * (ingress vs. application).
 */
export async function resolveTarget(config: Config, requested?: string): Promise<Target> {
  const name = requested ?? config.defaultProfile;
  const profile = name === undefined ? undefined : resolveProfile(config, name);
  if (name !== undefined && !profile) {
    throw new Error(
      requested
        ? `Unknown profile "${name}". Known profiles: ${knownProfileNames(config).join(", ")}.\n` +
            `  Add one with: ris config set ${name} --url <url>`
        : `Config sets defaultProfile "${name}", but no such profile exists.`,
    );
  }

  const url = (profile?.url ?? DEFAULT_API_URL).replace(/\/+$/, "");
  const headers: Record<string, string> = {};

  // Each `op://` reference is a separate `op read` subprocess, so resolve them
  // together rather than paying the 1Password round trips one after another.
  const [username, password, apiKey] = await Promise.all([
    resolveSecret(profile?.basic?.username ?? ""),
    resolveSecret(profile?.basic?.password ?? ""),
    resolveSecret(profile?.apiKey ?? ""),
  ]);

  if (profile?.basic) {
    const credentials = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
    headers.Authorization = `Basic ${credentials}`;
  }
  if (profile?.apiKey) headers["X-Api-Key"] = apiKey;

  return { url, profileName: name, headers };
}
