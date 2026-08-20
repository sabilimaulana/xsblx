import { BetterAuth } from "@alchemy.run/better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { MIN_PASSWORD_LENGTH } from "@xsblx/api/auth/credentials";
import type { RuntimeContext } from "alchemy";
import type * as Cloudflare from "alchemy/Cloudflare";
import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/d1";
import { Config, Effect, Redacted } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { SessionCookieConfig } from "../../config.ts";
import { newId } from "../../id.ts";
import { createAvatar } from "./avatar.ts";
import * as authSchema from "./schema.ts";

export type BetterAuthOptions = {
  /** The same D1 database the domain services use — one database, one schema. */
  readonly database: Cloudflare.D1.QueryDatabaseClient;
  readonly assets: Cloudflare.R2.ReadWriteBucketClient;
  /** The Worker's own public URL, resolved per request (`Cloudflare.Worker.URL`). */
  readonly baseUrl: Effect.Effect<string, never, RuntimeContext>;
  readonly trustedOrigins: ReadonlyArray<string>;
};

/**
 * Better Auth as a service (ADR 0022).
 *
 * On a Worker it cannot be the module-level singleton it was on Bun: the D1 and
 * R2 bindings only exist once a request is being served, so the instance is built
 * inside an `Effect.cached` — once per isolate, on the first request that needs
 * it, and never at plan or deploy time.
 *
 * The tag is alchemy's `BetterAuth`, so the service contract (an `auth`
 * accessor plus a `fetch` `HttpEffect`) is the one alchemy's own integration
 * uses. Its `CloudflareD1` layer is deliberately not used: that layer declares a
 * D1 database of its own, which would put the auth tables in a second database —
 * no foreign key from `todos.user_id`, and a second migration path.
 */
export const makeBetterAuth = (
  options: BetterAuthOptions,
): Effect.Effect<BetterAuth["Service"], Config.ConfigError> =>
  Effect.gen(function* () {
    // Resolved in the init phase so alchemy binds it as a secret on the Worker;
    // a `Config` first read inside a handler is never discovered and never bound.
    const secret = yield* Config.redacted("AUTH_SECRET");
    const sessionCookie = yield* SessionCookieConfig;

    const instance = yield* Effect.cached(
      Effect.gen(function* () {
        const d1 = yield* options.database.raw;
        const bucket = yield* options.assets.raw;
        const baseURL = yield* options.baseUrl;

        /**
         * Better Auth is a plain (non-Effect) library, so it gets the promise
         * drizzle driver over the raw binding rather than the Effect one the
         * domain services use. Same database, same tables — the table set is
         * declared on the adapter, which is the side that resolves models to
         * tables.
         */
        const db = drizzle(d1);

        return betterAuth({
          database: drizzleAdapter(db, { provider: "sqlite", schema: authSchema }),
          baseURL,
          secret: Redacted.value(secret),
          trustedOrigins: [...options.trustedOrigins],
          emailAndPassword: { enabled: true, minPasswordLength: MIN_PASSWORD_LENGTH },
          advanced: {
            /**
             * Better Auth's own generator is a nanoid over a different alphabet;
             * every id in this system is the same 21-character shape instead (ADR
             * 0017), so a user id and a todo id are told apart by their column,
             * not their format.
             */
            database: { generateId: () => newId() },
            /**
             * `SameSite` follows the stage's hostnames, and only the stage knows
             * them (ADR 0024).
             *
             * On `workers.dev` the two Workers are different *sites*, not merely
             * different origins (ADR 0008) — it is on the Public Suffix List — so
             * the cookie has to be `None` or it is silently dropped on every
             * cross-site request, leaving sign-in a 200 and everything after it
             * anonymous. The cost is a third-party cookie, which Safari's ITP
             * blocks and Firefox partitions by default.
             *
             * A stage that puts both Workers under one registrable domain
             * (`x.sblsblsbl.club` + `api.x.sblsblsbl.club`) is same-site, so it
             * sets `lax` and the cookie is first-party again — sent on the
             * website's own fetches, withheld from anyone else's. That is the
             * CSRF protection `None` gives up.
             *
             * No `domain` attribute either way: the cookie stays host-only to the
             * API, rather than being readable by every sibling hostname in the
             * zone.
             *
             * `Secure` is unconditional. Browsers treat `http://localhost` as
             * trustworthy, so dev is unaffected.
             */
            defaultCookieAttributes: { sameSite: sessionCookie.sameSite, secure: true },
          },
          /**
           * Every account gets a random blobatar at registration, written to R2
           * as SVG (ADR 0021). `before` rather than `after`: the URL is part of
           * the row that is inserted, so there is no window where a user has no
           * avatar and no second write to fail halfway.
           */
          databaseHooks: {
            user: {
              create: {
                before: async (user) => ({
                  data: { ...user, image: await createAvatar({ bucket, baseUrl: baseURL }) },
                }),
              },
            },
          },
          /**
           * Every authenticated request otherwise costs a session lookup. The
           * signed session travels in the cookie instead, so D1 is only
           * consulted once the cache expires.
           *
           * The cost is revocation lag: a deleted session or a changed role
           * stays live for up to `maxAge`. 60s keeps that window short — Better
           * Auth's own default is 300s, which is a long time to honour a
           * signed-out token.
           */
          session: { cookieCache: { enabled: true, maxAge: 60 } },
        });
      }),
    );

    return {
      auth: instance,
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const auth = yield* instance;
        const response = yield* Effect.promise(() => auth.handler(request.source as Request));
        // `fromWeb` splits the response's `set-cookie` values with
        // `getSetCookie()` before rebuilding them as cookies. Flattening the
        // headers into a record instead would merge them into one broken
        // cookie, which is the failure ADR 0007 exists to prevent.
        return HttpServerResponse.fromWeb(response);
      }),
    };
  });
