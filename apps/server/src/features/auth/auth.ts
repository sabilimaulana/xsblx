import { MIN_PASSWORD_LENGTH } from "@xsblx/api/auth/credentials";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/bun-sql";
import { createAvatar } from "./avatar.ts";
import { newId } from "../../id.ts";
import * as authSchema from "./schema.ts";

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
  /**
   * Better Auth's own generator is a nanoid over a different alphabet; every id
   * in this system is the same 21-character shape instead (ADR 0017), so a user
   * id and a todo id are told apart by their column, not their format.
   */
  advanced: { database: { generateId: () => newId() } },
  /**
   * Every account gets a random blobatar at registration, written to the object
   * store as SVG (ADR 0018). `before` rather than `after`: the URL is part of the
   * row that is inserted, so there is no window where a user has no avatar and no
   * second write to fail halfway.
   */
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({ data: { ...user, image: await createAvatar() } }),
      },
    },
  },
  /**
   * Every authenticated request otherwise costs a session lookup, which caps the
   * whole API around 5k req/s regardless of what the endpoint does (see
   * architecture.md, "Known ceilings"). The signed session travels in the cookie
   * instead, so the DB is only consulted once the cache expires.
   *
   * The cost is revocation lag: a deleted session or a changed role stays live
   * for up to `maxAge`. 60s keeps that window short — Better Auth's own default
   * is 300s, which is a long time to honour a signed-out token.
   */
  session: { cookieCache: { enabled: true, maxAge: 60 } },
});
