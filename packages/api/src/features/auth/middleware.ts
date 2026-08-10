import { Context, Schema } from "effect";
import { HttpApiMiddleware } from "effect/unstable/httpapi";

export class Unauthorized extends Schema.TaggedErrorClass<Unauthorized>()(
  "Unauthorized",
  {},
  { httpApiStatus: 401 },
) {}

/**
 * The authenticated caller, provided by the `Authentication` middleware. Handlers
 * and services take the id from here — it is never a payload field, because the
 * client must not be able to choose whose data it touches.
 */
export class CurrentUser extends Context.Service<
  CurrentUser,
  { readonly id: string; readonly email: string }
>()("api/CurrentUser") {}

/**
 * Declared here rather than in `apps/server` because it is part of the API
 * contract: it adds `Unauthorized` to every endpoint of the groups it guards.
 * The implementation (session lookup via Better Auth) lives on the server.
 */
export class Authentication extends HttpApiMiddleware.Service<
  Authentication,
  { provides: CurrentUser }
>()("api/Authentication", { error: Unauthorized }) {}
