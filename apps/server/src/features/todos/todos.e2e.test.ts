import { Api } from "@xsblx/api/api";
import * as Alchemy from "alchemy";
import * as Axiom from "alchemy/Axiom";
import * as Cloudflare from "alchemy/Cloudflare";
import { providers as drizzleProviders } from "alchemy/Drizzle/Providers";
import * as Test from "alchemy/Test/Bun";
import { describe, expect } from "bun:test";
import { Effect, Layer, Schedule } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import Stack from "../../../../../alchemy.run.ts";

/**
 * The integration test for a D1-backed service is an end-to-end test against a
 * deployed stage (ADR 0020): a D1 binding only exists inside a Worker, so there
 * is no off-platform database for a service test to point at. This file deploys
 * the stack to the `test` stage, drives the real API over HTTP with the same
 * typed client the web app uses, and destroys it again.
 *
 * It therefore needs Cloudflare credentials and is excluded from `bun run test`.
 * Run it with `bun run test:e2e`.
 */
describe("todos over the deployed API", () => {
  const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
    // Axiom's provider layer publishes the `HttpClient` the others consume, so it
    // is provided *into* the merge rather than merged beside it — `Layer.mergeAll`
    // builds in parallel and would leave that dependency unsatisfied.
    providers: Layer.mergeAll(Cloudflare.providers(), drizzleProviders()).pipe(
      Layer.provideMerge(Axiom.providers()),
    ),
    state: Alchemy.localState(),
  });

  const stack = beforeAll(
    deploy(Stack).pipe(
      Effect.tap(({ apiUrl }) =>
        // A fresh workers.dev URL takes a few seconds to start answering, so the
        // health endpoint is polled before any assertion runs.
        HttpClient.get(new URL("/health", apiUrl)).pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.retry({
            schedule: Schedule.max([Schedule.spaced("500 millis"), Schedule.recurs(20)]),
          }),
        ),
      ),
    ),
  );
  // `NO_DESTROY=1` leaves the stage — and its Axiom datasets — up, which is the
  // only way to read the trace of a run that just failed (ADR 0023).
  afterAll.skipIf(!!process.env["NO_DESTROY"])(destroy(Stack));

  /** The harness already provides `HttpClient`, so the client needs no layer. */
  const client = Effect.flatMap(stack, ({ apiUrl }) =>
    HttpApiClient.make(Api, {
      transformClient: HttpClient.mapRequest(HttpClientRequest.prependUrl(apiUrl)),
    }),
  );

  test(
    "answers /health",
    Effect.gen(function* () {
      const api = yield* client;
      const health = yield* api.health();
      expect(health.status).toBe("ok");
    }),
  );

  test(
    "rejects an unauthenticated list",
    Effect.gen(function* () {
      const api = yield* client;
      // The API is closed, not just the UI (ADR 0007): with no session cookie the
      // endpoint fails with the declared `Unauthorized`, never an empty page.
      const error = yield* api.todos
        .list({ query: { status: "all", limit: 20 } })
        .pipe(Effect.flip);
      expect(error._tag).toBe("Unauthorized");
    }),
  );
});
