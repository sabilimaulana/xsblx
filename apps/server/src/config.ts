import { Config } from "effect";

/**
 * Browsers block cross-origin mutations without these headers, and the web app is
 * a different Worker on a different hostname. Origins are configured, never
 * wildcarded — a wildcard would let any site call this API from a visitor's
 * browser (ADR 0008).
 *
 * The value is read in the Worker's init phase, so alchemy binds it as a secret
 * on the deployed Worker and the same `CORS_ALLOWED_ORIGINS` drives dev and prod.
 * It is deliberately not the website's `url` output: the website already consumes
 * the API's URL, and taking the reverse edge as well would make the two Workers
 * a cycle in the deploy graph.
 */
export const CorsConfig = Config.all({
  allowedOrigins: Config.nonEmptyString("CORS_ALLOWED_ORIGINS").pipe(
    Config.withDefault("http://localhost:3001"),
    Config.map((origins) => origins.split(",").map((origin) => origin.trim())),
  ),
});
