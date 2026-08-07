/**
 * Types for backend endpoints that are annotated `@Hidden` and therefore absent
 * from `spec/openapi.json`.
 *
 * These are hand-written and MUST NOT be moved into `api.d.ts`, which
 * `pnpm sync-spec` overwrites. Verified against the backend source in
 * `~/Projects/ris-search/backend`:
 *
 * - `NormsController.getWorkExamples`
 * - `TranslatedLegislationController.listAndFilter` / `getTranslationHTML`
 *
 * If an endpoint here later appears in the published spec, delete it from this
 * file and use the generated type instead.
 */
import type { components } from "./api.d.ts";

/**
 * `GET /v1/legislation/work-example/eli/{jurisdiction}/{agent}/{year}/{naturalIdentifier}`
 *
 * Returns every expression of a work. The member type is the same one the
 * documented legislation search uses, so it comes from the generated types.
 */
export type LegislationWorkExampleMember =
  components["schemas"]["LegislationExpressionSearchSchema"];

/**
 * `GET /v1/translatedLegislation?id=`
 *
 * Note the JSON-LD key names: the backend record's `id` and `filename` fields are
 * serialised as `@id` and `ris:filename` via `@JsonProperty`, so the obvious
 * property names would silently read as undefined.
 *
 * Every field is declared REQUIRED on the backend schema, but the controller also
 * sets `@JsonInclude(NON_NULL)`, so a field whose source value is absent is omitted
 * from the response entirely — hence the optional markers.
 */
export interface LegislationTranslation {
  "@type"?: "Legislation";
  "@id"?: string;
  name?: string;
  /** Always `"en"` today; the backend hard-codes it. */
  inLanguage?: string;
  translator?: string;
  /** The German title of the work this translates. */
  translationOfWork?: string;
  /** Version information, per the backend's mapping of `item.version()`. */
  about?: string;
  /** Pass to `GET /v1/translatedLegislation/{filename}` for the HTML. */
  "ris:filename"?: string;
}
