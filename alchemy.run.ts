import * as Alchemy from "alchemy";
import * as Axiom from "alchemy/Axiom";
import * as Cloudflare from "alchemy/Cloudflare";
import { providers as drizzleProviders } from "alchemy/Drizzle/Providers";
import { Effect, Layer } from "effect";
import { fileURLToPath } from "node:url";
import { Database } from "./apps/server/src/db/database.ts";
import ApiWorker from "./apps/server/src/worker.ts";

/**
 * The whole deploy, as one Effect program (ADR 0019).
 *
 * One stack for the monorepo: the website consumes the API's URL off an in-memory
 * `Output`, so there is nothing to sequence by hand and no cross-stack reference
 * to resolve. `alchemy deploy` from the workspace root puts both Workers up;
 * `alchemy destroy` takes them down together.
 *
 * Paths are absolute and anchored with `import.meta.url`, because relative paths
 * in a resource resolve against the directory `alchemy` was run from.
 */
export default Alchemy.Stack(
  "xsblx",
  {
    // Axiom's provider layer publishes the `HttpClient` the others consume, so it
    // is provided *into* the merge rather than merged beside it — `Layer.mergeAll`
    // builds in parallel and would leave that dependency unsatisfied.
    providers: Layer.mergeAll(Cloudflare.providers(), drizzleProviders()).pipe(
      Layer.provideMerge(Axiom.providers()),
    ),
    // Deploys share one state store, so a teammate's or CI's plan diffs against
    // the same recorded state this machine does.
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    // Yielded here only for the output: the D1 database and the R2 bucket join
    // the resource graph through the Worker's bindings, not through this file.
    const database = yield* Database;
    const api = yield* ApiWorker;

    const website = yield* Cloudflare.Website.Vite("Website", {
      rootDir: fileURLToPath(new URL("./apps/web", import.meta.url)),
      // `VITE_`-prefixed, so the API origin is inlined into the client bundle at
      // build time — the browser talks to the API Worker directly.
      env: { VITE_API_URL: api.url.as<string>() },
      // No `assets.runWorkerFirst`: with it, the SSR Worker answers *every*
      // request including `/assets/*`, has no route for them, and 404s the whole
      // client bundle while the document still renders. Assets-first only
      // intercepts requests that match a built file, so `/` and `/signin` reach
      // the Worker anyway — and a static hit costs no invocation.
      // The dev server keeps the port the CORS default allows.
      dev: { port: 3001 },
    });

    return {
      apiUrl: api.url.as<string>(),
      websiteUrl: website.url.as<string>(),
      databaseId: database.databaseId,
    };
  }),
);
