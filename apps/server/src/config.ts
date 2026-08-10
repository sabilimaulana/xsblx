import { Config } from "effect";

export const ServerConfig = Config.all({
  port: Config.port("PORT").pipe(Config.withDefault(3000)),
});

/**
 * Browsers block cross-origin mutations without these headers, and the web app
 * runs on a different port. Origins are configured, never wildcarded — a
 * wildcard would let any site call this API from a visitor's browser.
 */
export const CorsConfig = Config.all({
  allowedOrigins: Config.nonEmptyString("CORS_ALLOWED_ORIGINS").pipe(
    Config.withDefault("http://localhost:3001"),
    Config.map((origins) => origins.split(",").map((origin) => origin.trim())),
  ),
});

export const DatabaseConfig = Config.all({
  url: Config.redacted("DATABASE_URL"),
});

export const S3Config = Config.all({
  endpoint: Config.nonEmptyString("S3_ENDPOINT"),
  accessKey: Config.redacted("S3_ACCESS_KEY"),
  secretKey: Config.redacted("S3_SECRET_KEY"),
  bucket: Config.nonEmptyString("S3_BUCKET"),
});
