import { MIN_PASSWORD_LENGTH } from "@xsblx/api/domain/auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/bun-sql";
import * as authSchema from "./db/schema.ts";

/**
 * Better Auth owns its own connection: it is a plain (non-Effect) library and
 * runs outside the Effect runtime, so it cannot take the `Drizzle` service.
 * The domain services keep using `@effect/sql-pg`; only the auth tables are
 * touched through this client.
 */
const db = drizzle(process.env["DATABASE_URL"]!);

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
  baseURL: process.env["AUTH_URL"] ?? "http://localhost:3000",
  secret: process.env["AUTH_SECRET"],
  trustedOrigins: (process.env["CORS_ALLOWED_ORIGINS"] ?? "http://localhost:3001")
    .split(",")
    .map((origin) => origin.trim()),
  emailAndPassword: { enabled: true, minPasswordLength: MIN_PASSWORD_LENGTH },
});
