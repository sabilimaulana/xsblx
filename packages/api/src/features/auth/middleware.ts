import { Context, Schema } from "effect";
import { HttpApiMiddleware } from "effect/http-api";
import { HttpRouter } from "effect/http";
import { Auth } from "@yielded/auth";

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
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
>()("@xsblx/api/features/auth/middleware/CurrentUser") {}

/**
 * Declared here rather than in `apps/server` because it is part of the API
 * contract: it adds `Unauthorized` to every endpoint of the groups it guards.
 * The implementation (session lookup via yielded-auth) lives on the server.
 *
 * `requires` is yielded's validated request as a *request marker*, not a plain
 * service: it is satisfied per request by the yielded HTTP middleware the
 * server applies to these routes (the same shape yielded's own session
 * security declares), never by a build-time layer.
 */
export class Authentication extends HttpApiMiddleware.Service<
  Authentication,
  { provides: CurrentUser; requires: HttpRouter.Request.From<"Requires", Auth.AuthRequest> }
>()("api/Authentication", { error: Unauthorized }) {}
