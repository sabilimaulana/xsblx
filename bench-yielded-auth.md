# yielded-auth spike: bundle / performance / flexibility numbers

> **2026-10-04 ~12:45 WIB postscript — the caveat below is resolved.** The
> `PasswordUnavailable` on all password flows was a stale dev Worker (old
> bundle serving new-table traffic), not a code regression: after a clean
> `bun run dev` restart the migration applied and every flow verified green
> on the native code — fresh register → `RegistrationAccepted`, sign-in →
> session cookie, `GET /todos` → 200 + create/list, duplicate register →
> suppressed-accepted, wrong password → `PasswordRejected`, plus new native
> `POST /api/auth/sign-out` → `revoked` + cleared cookie + old bearer 401.
> Latency numbers below stay as measured (error-path); success-path register
> 0.107–0.126 s (n=3) was observed on a good boot. Positive-path precise
> timing + per-flow D1 deltas still unmeasured — next step when needed.

Branch `yielded-auth`, measured 2026-10-04 ~12:30 WIB against dev Worker on `localhost:1337`.
⚠️ **Caveat first:** the currently-deployed worker (rebuilt 12:27, uncommitted spike in progress)
returns `PasswordUnavailable` on **all** password flows. Latencies below are real timings, but
register/sign-in numbers are **error-path**, not success-path. Success-path register (HTTP 200,
`RegistrationAccepted`, ~58 B body) was observed on the pre-12:27 boot at 0.107–0.126 s (n=3).

## 1. Bundle size

| Artifact | Bytes |
|---|---|
| `Api/worker.js` | 924,665 (903 K; gzip 242,424 ≈ 236 K) |
| `Api/worker.js.map` | 4,043,285 |
| sourcesContent total (409 modules) | 2,865,712 |
| …of which `@yielded/*` (162 modules, 39.6% of files) | 1,000,629 (**34.9%**) |
| …of which `effect` runtime | 1,021,380 (35.6%) |
| …of which app code (`apps/`, `packages/`) | 163,687 (5.7%) |
| …of which `better-auth` | **0 (0 modules, 0 mentions in bundle)** |

better-auth is imported by `apps/server/.../auth.ts` but contributes nothing to the Api worker
bundle on this branch — the yielded spike replaced it on the served path.

| Installed dist (`node_modules/.bun`) | Size |
|---|---|
| `@yielded/auth/dist` | 11 M (pkg dir 13 M) |
| `@yielded/auth-crypto` | 304 K |
| `@yielded/auth-persistence` | 3.2 M |
| `@yielded/auth-persistence-drizzle` | 6.5 M |
| **@yielded total on disk** | **≈23 M** |
| `better-auth` (pkg, 2 copies) | 3.5 M + 356 K (dist 3.4 M + 268 K) |

## 2. Performance (curl, localhost, `Origin: https://xsblx-api-hermes.sblsblsbl.club` + `x-effect-auth-csrf: 1`)

| Flow | Result (current boot) | Latency |
|---|---|---|
| `POST /api/auth/register` (new user, `flow-bench-N`) | 400 `PasswordUnavailable` | ~0.107–0.125 s (n=5) |
| `POST /api/auth/passwordSignIn` (existing user) | 400 `PasswordUnavailable` | ~0.002–0.005 s (n=5; fails before hashing) |
| `GET /todos` no cookie (session-verify reject path) | 401 | 0.0013–0.0019 s warm (0.019 s cold isolate) |
| `GET /todos` bogus cookie | 401 | ~0.0013 s (reject before D1) |
| `GET /health` | 200 | not timed (healthy) |

No valid session could be minted (sign-in broken), so **positive** session-verify latency is unmeasurable
until the regression is fixed. `bench@example.com` already exists in dev D1 (prior run); fresh
`benchflow-*`/`delta-*` addresses used instead.

D1 row counts (local sqlite `…/d1/cloudflare-runtime-D1DatabaseObject/8ba8cc59…sqlite`, steady state):
`credentials=6, identifiers=6, passwordAttempts=25, passwordCharges=73, passwordRegistrations=6,
passwords=6 (argon2id `m=19456,t=2,p=1`), sessionFlows=22, sessions=22`; all `proof*` tables = 0,
`passwordCommands=0, passwordScopes=0`. **Per-flow delta on the current boot: 0 rows in all 19
`xsblx_auth_*` tables** for register, sign-in, and session-reject — the failure happens before any
domain write (one `passwordAttempts` + two `passwordCharges` rows leaked from an earlier failing
attempt, i.e. the flow reaches attempt-tracking then dies; `yielded-password-ports.ts` maps *any*
storage/hashing defect to `PasswordUnavailable`, swallowing the cause).

## 3. Flexibility: knobs yielded exposes vs better-auth (as configured in this repo)

Password policy — yielded `PasswordPolicy`: `assurance` (single-factor|always-mfa),
`normalization` (NFC|none), `minimumCodePoints` (default 15 NIST SP800-63B-4, 8 iff always-mfa;
spike sets 8), `maximumCodePoints`, `maximumBytes` + separate `PasswordMethodPolicy` (per-identifier /
per-subject / per-action attempt limit+window, `maximumPending`, `attemptLifetimeMillis`,
`maximumEvidenceAgeMillis`, `requireImmediateInvalidation`) + `CompromisedPasswords` seam (spike:
allow-all) + Argon2id-via-WebCrypto KDF. better-auth here: only `minPasswordLength` (= 8, shared
`MIN_PASSWORD_LENGTH`) — no attempt-limiting or breach-screening knobs in use.

Session policy — yielded `Sessions.stateful()` (spike uses defaults): `idleTimeout`, `maxAge`,
`renewAfter`, `issuer`, `audience`, `generation`, `maximumIssuedAge`, `maximumTokenBytes`, plus two
more modes (`stateless`, `state-assisted`); spike re-checks password revision on every verify (change
invalidates sessions). better-auth here: `session.cookieCache { maxAge: 60 }` (signed-cookie cache;
default 300 s), single `AUTH_SECRET` for everything vs yielded's split proof/binding keyrings
(`AUTH_PROOF_KEY`/`AUTH_BINDING_KEY`, 32 B base64url, `v1` rotation-ready).

Hooks/events — yielded: `LifecycleHooks`/`coordinateCommit` over 11 actions (`registration`,
`sign-in`, `session-creation`, `credential-change`, `factor-change`, `identifier-change`, `linking`,
`sign-out`, `proof-request/verification/completion`) with sync/interactive/batch-outbox contributions
and `HookDenied` veto; spike wires app `Provisioning`+`SessionClaims`, fail-closed `EmailDelivery`,
deny-all `PasswordActionEvidence` (no change/reset yet). better-auth here: one
`databaseHooks.user.create.before` (R2 blobatar avatar) — no veto/event-bus equivalent in use.

**Bottom line:** yielded ≈ 35% of worker sourcesContent (≈1.0 MB src, 11 MB dist) for strictly more
knobs (attempt policies, 3 session modes, 11-action hook bus, split keyrings) than the better-auth
config it replaces; but on the current boot **zero password flows succeed**, so no success-path
latency or per-flow D1-statement count exists yet — re-run §2 after the `PasswordUnavailable`
regression is fixed (start in `yielded-password-ports.ts:73`, the catch-all mapper).
