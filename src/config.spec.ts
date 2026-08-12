import { describe, expect, it } from "vitest";
import { DEFAULT_API_URL, configPath, resolveTarget, type Config } from "./config.ts";

const CONFIG: Config = {
  defaultProfile: "local",
  profiles: {
    local: { url: "http://localhost:8080" },
    staging: {
      url: "https://staging.example.org",
      basic: { username: "sam", password: "secret" },
    },
    prod: { url: "https://prod.example.org", apiKey: "ris_abc" },
    both: {
      url: "https://both.example.org",
      basic: { username: "sam", password: "secret" },
      apiKey: "ris_abc",
    },
  },
};

const NO_ENV: NodeJS.ProcessEnv = {};

function basicHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

describe("config", () => {
  describe("configPath", () => {
    it("honours XDG_CONFIG_HOME", () => {
      expect(configPath({ XDG_CONFIG_HOME: "/xdg" })).toBe("/xdg/ris-cli/config.json");
    });

    it("falls back to ~/.config", () => {
      expect(configPath({ HOME: "/home/sam" })).toBe("/home/sam/.config/ris-cli/config.json");
    });
  });

  describe("resolveTarget URL precedence", () => {
    it("prefers --api-url over everything else", async () => {
      const target = await resolveTarget(
        CONFIG,
        { apiUrl: "https://flag.example.org", profile: "staging" },
        { RIS_API_URL: "https://env.example.org" },
      );
      expect(target.url).toBe("https://flag.example.org");
    });

    it("prefers --profile over the environment", async () => {
      const target = await resolveTarget(
        CONFIG,
        { profile: "staging" },
        {
          RIS_API_URL: "https://env.example.org",
        },
      );
      expect(target.url).toBe("https://staging.example.org");
      expect(target.profileName).toBe("staging");
    });

    it("uses $RIS_API_URL ahead of the default profile", async () => {
      const target = await resolveTarget(CONFIG, {}, { RIS_API_URL: "https://env.example.org" });
      expect(target.url).toBe("https://env.example.org");
      expect(target.profileName).toBeUndefined();
    });

    it("falls back to the default profile", async () => {
      const target = await resolveTarget(CONFIG, {}, NO_ENV);
      expect(target.url).toBe("http://localhost:8080");
      expect(target.profileName).toBe("local");
    });

    it("falls back to localhost when nothing is configured", async () => {
      const target = await resolveTarget({ profiles: {} }, {}, NO_ENV);
      expect(target.url).toBe(DEFAULT_API_URL);
    });

    it("resolves built-in profiles that are absent from the config file", async () => {
      const target = await resolveTarget({ profiles: {} }, { profile: "testphase" }, NO_ENV);
      expect(target.url).toBe("https://testphase.rechtsinformationen.bund.de");
    });

    it("strips a trailing slash so paths do not double up", async () => {
      const target = await resolveTarget(CONFIG, { apiUrl: "https://example.org/" }, NO_ENV);
      expect(target.url).toBe("https://example.org");
    });

    it("explains what to do when the profile is unknown", async () => {
      await expect(resolveTarget(CONFIG, { profile: "nope" }, NO_ENV)).rejects.toThrow(
        /Unknown profile "nope"/,
      );
    });
  });

  describe("resolveTarget auth", () => {
    it("sends no credentials when the profile has none", async () => {
      const target = await resolveTarget(CONFIG, { profile: "local" }, NO_ENV);
      expect(target.headers).toEqual({});
    });

    it("builds a Basic header from the profile", async () => {
      const target = await resolveTarget(CONFIG, { profile: "staging" }, NO_ENV);
      expect(target.headers.Authorization).toBe(basicHeader("sam", "secret"));
    });

    it("builds an X-Api-Key header from the profile", async () => {
      const target = await resolveTarget(CONFIG, { profile: "prod" }, NO_ENV);
      expect(target.headers["X-Api-Key"]).toBe("ris_abc");
    });

    it("composes Basic and API key, since they are enforced at different layers", async () => {
      const target = await resolveTarget(CONFIG, { profile: "both" }, NO_ENV);
      expect(target.headers.Authorization).toBe(basicHeader("sam", "secret"));
      expect(target.headers["X-Api-Key"]).toBe("ris_abc");
    });

    it("lets the environment override profile credentials", async () => {
      const target = await resolveTarget(
        CONFIG,
        { profile: "staging" },
        {
          RIS_BASIC_USER: "env-user",
          RIS_BASIC_PASSWORD: "env-pass",
          RIS_API_KEY: "ris_env",
        },
      );
      expect(target.headers.Authorization).toBe(basicHeader("env-user", "env-pass"));
      expect(target.headers["X-Api-Key"]).toBe("ris_env");
    });

    it("lets flags override the environment", async () => {
      const target = await resolveTarget(
        CONFIG,
        { profile: "prod", apiKey: "ris_flag" },
        {
          RIS_API_KEY: "ris_env",
        },
      );
      expect(target.headers["X-Api-Key"]).toBe("ris_flag");
    });

    it("drops all credentials for --no-auth", async () => {
      const target = await resolveTarget(CONFIG, { profile: "both", noAuth: true }, NO_ENV);
      expect(target.headers).toEqual({});
    });

    it("rejects a username with no password rather than sending a broken header", async () => {
      await expect(
        resolveTarget(CONFIG, { profile: "local", user: "sam" }, NO_ENV),
      ).rejects.toThrow(/no password/);
    });
  });
});
