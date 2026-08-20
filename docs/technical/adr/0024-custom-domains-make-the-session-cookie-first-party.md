---
status: accepted
version: 1.0.0
updated: 2026-08-20
---

# 0024 — Custom domains per stage, and a first-party session cookie

## Context

ADR 0022 recorded a ceiling it could not lift. The API and the website are
separate Workers, and both were reachable only at `*.workers.dev`. `workers.dev`
is on the Public Suffix List, so the two hostnames are not merely different
origins (ADR 0008) — they are different **sites**. A `SameSite=Lax` cookie is
never sent on a cross-site request, and nothing reports the omission: sign-in
returns 200 and sets the cookie, and every call after it is anonymous.

The only value that works across sites is `SameSite=None`, which makes the
session cookie third-party. Safari's ITP blocks third-party cookies outright and
Firefox partitions them by default, so the deployment was one browser default
away from being unusable — and `None` gives up the CSRF protection `Lax` exists
to provide. ADR 0022 named the fix and deferred it: _"A shared registrable domain
is the only real fix … it needs a zone, so it is not this branch's decision yet."_

The account now has one: `sblsblsbl.club`, on Cloudflare's Free plan.

Two things were unknown and were measured rather than assumed:

- **Free-plan Universal SSL covers the apex and one label of subdomain.**
  `api.x.sblsblsbl.club` is two labels deep and outside that certificate. Workers
  Custom Domains turned out to provision their own edge certificate regardless —
  the hostname served valid TLS (`ssl_verify_result=0`) within minutes, with no
  Advanced Certificate Manager and no paid plan.
- **A stage name is not always a legal hostname.** The default stage is
  `dev_$USER` — `dev_sabilimaulana` contains an underscore, which no hostname may.
  Deriving hostnames from the stage would fail on the most common stage of all.

## Decision

**Hostnames are configuration, set per stage, and the session cookie's `SameSite`
is declared alongside them.**

- **`API_DOMAIN` and `WEB_DOMAIN` name the hostnames a stage serves on.** Both are
  optional. Unset — the normal case — means _unmanaged_: alchemy leaves custom
  domains alone and the Worker keeps its generated `workers.dev` URL. Only `prod`
  sets them, from `.env.prod.local`:

  | Worker  | Hostname               |
  | ------- | ---------------------- |
  | Website | `x.sblsblsbl.club`     |
  | API     | `api.x.sblsblsbl.club` |

- **They are passed as `Config`, not as resolved values.** A resource prop accepts
  `Config<T>` directly (alchemy's `Input<T>`), so `domain: ApiDomainConfig` is a
  plain field on the Worker's props. The three-argument class form of
  `Cloudflare.Worker` takes only plain props — an `Effect` is rejected — so this
  is the way a prop becomes per-stage without a second stack file.

- **Cloudflare manages the DNS record and the certificate.** Nothing in this repo
  writes a DNS record, a Workers route, or an `AAAA 100::` placeholder. Setting
  `domain` also makes `https://<name>` the Worker's primary `url` output, which is
  what feeds `VITE_API_URL` — so the website's client bundle follows the API's
  hostname with no second place to update.

- **`SESSION_COOKIE_SAMESITE` selects `lax` or `none`, defaulting to `none`.**
  `prod` sets `lax`, because its two hostnames share the registrable domain
  `sblsblsbl.club` and are therefore same-site. Every stage on `workers.dev`
  leaves it at the default.

- **Declared, never derived.** Deciding whether two hostnames share a registrable
  domain means consulting the Public Suffix List. Getting it wrong in the `lax`
  direction signs everyone out silently — the exact failure this ADR exists to
  remove — so the answer is stated, not computed.

- **No `Domain` attribute on the cookie.** It stays host-only to the API rather
  than being readable by every sibling hostname in the zone. `Lax` already travels
  to a same-site sibling; widening the cookie's scope buys nothing.

- **`Secure` stays unconditional**, under both values. Browsers treat
  `http://localhost` as a trustworthy origin, so dev is unaffected.

This amends ADR 0022's cookie clause. The rest of 0022 — Better Auth as a service
over the app's own D1, built inside `Effect.cached` — is untouched.

## Consequences

- **The prod session cookie is first-party.** It survives Safari's ITP and
  Firefox's partitioning rather than depending on the browser's tolerance for
  third-party cookies, and `Lax` withholds it from cross-site requests, which is
  CSRF protection `None` did not give.
- **CORS is still load-bearing and still an allow-list.** Same-site is not same
  origin: `x.sblsblsbl.club` calling `api.x.sblsblsbl.club` is a cross-origin
  request, so ADR 0008 stands unchanged, `credentials: true` included.
- **Two stages cannot share a hostname**, and only one stage has one. A second
  stage wanting custom domains needs its own labels and a stage name that is a
  legal hostname — which `dev_$USER` is not. Sanitising stage names into hostnames
  is deliberately not done here; nothing needs it yet.
- **The `workers.dev` URLs still answer.** A custom domain adds a hostname, it
  does not remove one, so prod is reachable at both. The CORS allow-list names
  only the custom domain, so a browser cannot use the `workers.dev` API origin
  from the site — but it remains a second public entry point. Disabling it is a
  `workersDev` toggle away if that matters.
- **Certificate provisioning is not instant, and DNS lags further.** The
  hostnames answered TLS within a couple of minutes; the website's A record took
  roughly two more to appear in public resolvers, and a resolver that had already
  cached `NXDOMAIN` held it past that. A deploy that immediately smoke-tests a
  brand-new hostname will see failures that are not failures.
- **A stage's cookie policy is only as right as its env file.** Setting `lax`
  without matching hostnames breaks every session on that stage, and nothing
  detects it before a browser tries. The two values belong to the same file for
  that reason.
