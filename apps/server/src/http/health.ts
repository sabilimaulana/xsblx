import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Api } from "@asshls/api/api";

export const HealthHandlers = HttpApiBuilder.group(
  Api,
  "health",
  Effect.fn(function* (handlers) {
    return handlers.handle("health", () => Effect.succeed({ status: "ok" as const }));
  }),
);
