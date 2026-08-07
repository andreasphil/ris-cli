import { describe, expect, it } from "vitest";
import { ApiError, buildUrl, toCurl } from "./client.ts";

describe("client", () => {
  describe("buildUrl", () => {
    it("joins the base URL and path", () => {
      expect(buildUrl("http://localhost:8090", "/v1/case-law")).toBe(
        "http://localhost:8090/v1/case-law",
      );
    });

    it("tolerates a path without a leading slash", () => {
      expect(buildUrl("http://localhost:8090", "v1/case-law")).toBe(
        "http://localhost:8090/v1/case-law",
      );
    });

    it("appends query parameters", () => {
      expect(buildUrl("http://x", "/v1/case-law", { searchTerm: "Miete", size: 5 })).toBe(
        "http://x/v1/case-law?searchTerm=Miete&size=5",
      );
    });

    it("omits empty values so unset flags do not reach the API", () => {
      expect(
        buildUrl("http://x", "/v1/case-law", {
          searchTerm: undefined,
          court: null,
          ecli: "",
          size: 5,
        }),
      ).toBe("http://x/v1/case-law?size=5");
    });

    it("keeps pageIndex=0, which is a meaningful value", () => {
      expect(buildUrl("http://x", "/v1/case-law", { pageIndex: 0 })).toBe(
        "http://x/v1/case-law?pageIndex=0",
      );
    });

    it("repeats array parameters, as the API expects for multi-value filters", () => {
      expect(buildUrl("http://x", "/v1/case-law", { type: ["Urteil", "Beschluss"] })).toBe(
        "http://x/v1/case-law?type=Urteil&type=Beschluss",
      );
    });

    it("percent-encodes umlauts and spaces", () => {
      expect(buildUrl("http://x", "/v1/case-law", { court: "FG Münster" })).toBe(
        "http://x/v1/case-law?court=FG+M%C3%BCnster",
      );
    });

    it("builds a nine-segment legislation manifestation path", () => {
      expect(
        buildUrl(
          "http://x",
          "/v1/legislation/eli/bund/bgbl-1/1979/s1325/2020-06-19/2/deu/2020-06-19/regelungstext-1.html",
        ),
      ).toBe(
        "http://x/v1/legislation/eli/bund/bgbl-1/1979/s1325/2020-06-19/2/deu/2020-06-19/regelungstext-1.html",
      );
    });
  });

  describe("toCurl", () => {
    it("prints a plain request", () => {
      expect(toCurl("http://x/v1/statistics", {})).toBe("curl -sS http://x/v1/statistics");
    });

    it("references env vars instead of leaking Basic credentials", () => {
      const curl = toCurl("http://x/v1/statistics", { Authorization: "Basic c2FtOnNlY3JldA==" });
      expect(curl).toContain("$RIS_BASIC_USER:$RIS_BASIC_PASSWORD");
      expect(curl).not.toContain("c2FtOnNlY3JldA==");
    });

    it("references an env var instead of leaking the API key", () => {
      const curl = toCurl("http://x/v1/statistics", { "X-Api-Key": "ris_supersecret" });
      expect(curl).toContain("$RIS_API_KEY");
      expect(curl).not.toContain("ris_supersecret");
    });

    it("quotes a URL containing query separators", () => {
      expect(toCurl("http://x/v1/case-law?a=1&b=2", {})).toBe(
        "curl -sS 'http://x/v1/case-law?a=1&b=2'",
      );
    });
  });

  describe("ApiError", () => {
    it("suggests credentials on 401", () => {
      expect(new ApiError(401, "http://x", "").message).toMatch(/requires authentication/);
    });

    it("mentions the rate limit on 429", () => {
      expect(new ApiError(429, "http://x", "").message).toMatch(/600 requests\/minute/);
    });

    it("surfaces the response body on 422", () => {
      expect(new ApiError(422, "http://x", "bad sort field").message).toMatch(/bad sort field/);
    });

    it("collapses and truncates a long body", () => {
      const message = new ApiError(500, "http://x", `${"a".repeat(900)}\n\n  b`).message;
      expect(message).toContain("…");
      expect(message.length).toBeLessThan(500);
    });
  });
});
