import { Http } from "@yielded/auth";

import { AppAuth } from "./yielded-auth.ts";

/**
 * yielded HTTP surface.
 *
 * `Http.make` builds the operation routes, the per-request middleware (which
 * provides `AuthRequest`, the validated request the session API needs), and
 * the session-security layer. `origin` is the API Worker's own URL;
 * `trustedOrigins` are the websites allowed to call it. yielded rejects a
 * request whose `Origin` is neither with a 403 `TransportFailure` "origin", on
 * top of requiring the `x-effect-auth-csrf` header on mutations.
 *
 * Callers pass the CORS allow-list (ADR 0008): the browsers trusted to send
 * credentials are the same set trusted to call auth. yielded admits HTTPS
 * origins only, so an `http://localhost` entry stays CORS-allowed but cannot
 * hold a session — browser sign-in in dev goes through the HTTPS tunnel.
 *
 * Cookie is `Secure` + `lax` — yielded offers no `none` (ADR 0030). The
 * website and the API must therefore be the same *site*: localhost, a tunnel
 * subdomain, or a shared registrable domain via `WEB_DOMAIN`/`API_DOMAIN`. Two
 * `workers.dev` hostnames are different sites, and the browser never sends the
 * cookie between them.
 */
export const makeYieldedHttp = ({
  origin,
  allowedOrigins,
}: {
  readonly origin: string;
  readonly allowedOrigins: ReadonlyArray<string>;
}) =>
  Http.make(AppAuth, {
    origin,
    trustedOrigins: allowedOrigins.filter((candidate) => candidate.startsWith("https://")),
    cookie: { secure: true, sameSite: "lax" },
  });
