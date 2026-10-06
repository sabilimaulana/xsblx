import { assert, it } from "@effect/vitest";
import { Config, ConfigProvider, Effect, Exit } from "effect";

import { ApiPublicOriginConfig, CorsConfig } from "./config.ts";

/**
 * Origins are compared as strings by CORS and by yielded, so a value that is
 * not exactly an origin must fail as a `ConfigError` at deploy rather than
 * reaching the Worker.
 */
const load = <A>(config: Config.Config<A>, env: Record<string, string>) =>
  config.parse(ConfigProvider.fromEnv({ env }));

it.effect("accepts exact origins, http and https", () =>
  Effect.gen(function* () {
    const cors = yield* load(CorsConfig, {
      CORS_ALLOWED_ORIGINS: "http://localhost:3001, https://app.example.com",
    });
    assert.deepStrictEqual(cors.allowedOrigins, [
      "http://localhost:3001",
      "https://app.example.com",
    ]);
  }),
);

it.effect("rejects a path, a trailing slash, a wildcard or another scheme", () =>
  Effect.gen(function* () {
    for (const bad of [
      "https://app.example.com/",
      "https://app.example.com/x",
      "*",
      "ftp://a.example.com",
    ]) {
      const exit = yield* Effect.exit(load(CorsConfig, { CORS_ALLOWED_ORIGINS: bad }));
      assert.isTrue(Exit.isFailure(exit), bad);
    }
  }),
);

it.effect("requires https for the API's own origin", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(
      load(ApiPublicOriginConfig, { API_PUBLIC_ORIGIN: "http://api.example.com" }),
    );
    assert.isTrue(Exit.isFailure(exit));
    const ok = yield* load(ApiPublicOriginConfig, { API_PUBLIC_ORIGIN: "https://api.example.com" });
    assert.strictEqual(ok, "https://api.example.com");
  }),
);
