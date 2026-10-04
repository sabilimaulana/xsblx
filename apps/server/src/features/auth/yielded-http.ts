import { Http } from "@yielded/auth";

import { AppAuth } from "./yielded-auth.ts";

/**
 * Spike: yielded HTTP surface.
 *
 * `Http.make` builds the operation routes, the per-request middleware (which
 * provides `AuthRequest`, the validated request the session API needs), and
 * the session-security layer. Origin is the API Worker's own URL — CSRF
 * protection for browser mutations comes from the `x-effect-auth-csrf`
 * header the client sends, not from origin matching.
 *
 * Cookie is `Secure` + `lax`: the website and the API are different hosts but
 * the same site on every stage (tunnel subdomain, localhost, or a shared
 * registrable domain), so `lax` authenticates fetches while staying off
 * third-party-cookie semantics. There is deliberately no `SameSite=none`
 * fallback — see the old `auth.ts` comment for why `none` was a trap.
 */
export const makeYieldedHttp = (origin: string) =>
  Http.make(AppAuth, {
    origin,
    cookie: { secure: true, sameSite: "lax" },
  });
