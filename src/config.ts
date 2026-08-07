import { execFile } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_API_URL = "http://localhost:8090";

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
          `  Install it with \`brew install 1password-cli\`, or pass credentials via ` +
          `RIS_BASIC_PASSWORD / RIS_API_KEY instead.`,
      );
    }
    throw new Error(`Cannot resolve ${value} via 1Password: ${stderr || (error as Error).message}`);
  }
}

export interface AuthFlags {
  user?: string;
  passwordStdin?: boolean;
  apiKey?: string;
  noAuth?: boolean;
}

export interface TargetFlags extends AuthFlags {
  apiUrl?: string;
  profile?: string;
}

export interface Target {
  url: string;
  /** Which profile the URL came from, for error messages. Absent when --api-url won. */
  profileName?: string;
  headers: Record<string, string>;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/, "");
}

/**
 * Resolves base URL and auth headers.
 *
 * URL precedence: --api-url > --profile > $RIS_API_URL > default profile > localhost.
 * Auth precedence: flags > environment > profile. Basic and API key compose, because
 * they are enforced at different layers (ingress vs. application).
 */
export async function resolveTarget(
  config: Config,
  flags: TargetFlags,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Target> {
  let url: string | undefined;
  let profileName: string | undefined;
  let profile: Profile | undefined;

  if (flags.profile) {
    profile = resolveProfile(config, flags.profile);
    if (!profile) {
      throw new Error(
        `Unknown profile "${flags.profile}". Known profiles: ${knownProfileNames(config).join(", ")}.\n` +
          `  Add one with: ris config set ${flags.profile} --url <url>`,
      );
    }
    profileName = flags.profile;
    url = profile.url;
  } else if (!flags.apiUrl && !env.RIS_API_URL && config.defaultProfile) {
    profile = resolveProfile(config, config.defaultProfile);
    if (!profile) {
      throw new Error(
        `Config sets defaultProfile "${config.defaultProfile}", but no such profile exists.`,
      );
    }
    profileName = config.defaultProfile;
    url = profile.url;
  }

  url = flags.apiUrl || url || env.RIS_API_URL || DEFAULT_API_URL;

  const headers: Record<string, string> = {};
  if (flags.noAuth) return { url: url.replace(/\/+$/, ""), profileName, headers };

  const username = flags.user ?? env.RIS_BASIC_USER ?? profile?.basic?.username;
  let password: string | undefined;
  if (flags.passwordStdin) {
    password = await readStdin();
  } else {
    password = env.RIS_BASIC_PASSWORD ?? profile?.basic?.password;
  }

  if (username && password) {
    const resolved = `${await resolveSecret(username)}:${await resolveSecret(password)}`;
    headers.Authorization = `Basic ${Buffer.from(resolved, "utf8").toString("base64")}`;
  } else if (username && !password) {
    throw new Error(
      `A username was given but no password. Pipe one in with --password-stdin, ` +
        `set RIS_BASIC_PASSWORD, or store a reference in the profile.`,
    );
  }

  const apiKey = flags.apiKey ?? env.RIS_API_KEY ?? profile?.apiKey;
  if (apiKey) headers["X-Api-Key"] = await resolveSecret(apiKey);

  return { url: url.replace(/\/+$/, ""), profileName, headers };
}
