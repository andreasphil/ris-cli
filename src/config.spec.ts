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
    trailing: { url: "https://trailing.example.org/" },
  },
};

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

  describe("resolveTarget URL", () => {
    it("takes the URL from --profile", async () => {
      const target = await resolveTarget(CONFIG, { profile: "staging" });
      expect(target.url).toBe("https://staging.example.org");
      expect(target.profileName).toBe("staging");
    });

    it("falls back to the default profile", async () => {
      const target = await resolveTarget(CONFIG, {});
      expect(target.url).toBe("http://localhost:8080");
      expect(target.profileName).toBe("local");
    });

    it("falls back to localhost when nothing is configured", async () => {
      const target = await resolveTarget({ profiles: {} }, {});
      expect(target.url).toBe(DEFAULT_API_URL);
      expect(target.profileName).toBeUndefined();
    });

    it("ignores the environment", async () => {
      process.env.RIS_API_URL = "https://env.example.org";
      try {
        const target = await resolveTarget(CONFIG, {});
        expect(target.url).toBe("http://localhost:8080");
      } finally {
        delete process.env.RIS_API_URL;
      }
    });

    it("resolves built-in profiles that are absent from the config file", async () => {
      const target = await resolveTarget({ profiles: {} }, { profile: "testphase" });
      expect(target.url).toBe("https://testphase.rechtsinformationen.bund.de");
    });

    it("strips a trailing slash so paths do not double up", async () => {
      const target = await resolveTarget(CONFIG, { profile: "trailing" });
      expect(target.url).toBe("https://trailing.example.org");
    });

    it("explains what to do when the profile is unknown", async () => {
      await expect(resolveTarget(CONFIG, { profile: "nope" })).rejects.toThrow(
        /Unknown profile "nope"/,
      );
    });

    it("rejects a default profile that does not exist", async () => {
      await expect(resolveTarget({ defaultProfile: "gone", profiles: {} }, {})).rejects.toThrow(
        /no such profile exists/,
      );
    });
  });

  describe("resolveTarget auth", () => {
    it("sends no credentials when the profile has none", async () => {
      const target = await resolveTarget(CONFIG, { profile: "local" });
      expect(target.headers).toEqual({});
    });

    it("builds a Basic header from the profile", async () => {
      const target = await resolveTarget(CONFIG, { profile: "staging" });
      expect(target.headers.Authorization).toBe(basicHeader("sam", "secret"));
    });

    it("builds an X-Api-Key header from the profile", async () => {
      const target = await resolveTarget(CONFIG, { profile: "prod" });
      expect(target.headers["X-Api-Key"]).toBe("ris_abc");
    });

    it("composes Basic and API key, since they are enforced at different layers", async () => {
      const target = await resolveTarget(CONFIG, { profile: "both" });
      expect(target.headers.Authorization).toBe(basicHeader("sam", "secret"));
      expect(target.headers["X-Api-Key"]).toBe("ris_abc");
    });

    it("ignores credentials in the environment", async () => {
      process.env.RIS_BASIC_USER = "env-user";
      process.env.RIS_BASIC_PASSWORD = "env-pass";
      process.env.RIS_API_KEY = "ris_env";
      try {
        const target = await resolveTarget(CONFIG, { profile: "local" });
        expect(target.headers).toEqual({});
      } finally {
        delete process.env.RIS_BASIC_USER;
        delete process.env.RIS_BASIC_PASSWORD;
        delete process.env.RIS_API_KEY;
      }
    });
  });
});
