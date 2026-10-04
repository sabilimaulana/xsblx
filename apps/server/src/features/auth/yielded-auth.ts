import { XsblxAuthApi, Registration, sessionConfiguration } from "@xsblx/api/auth/yielded";
import { Auth, Password } from "@yielded/auth";

/**
 * Spike: yielded-auth replaces Better Auth on the `yielded-auth` branch.
 *
 * Password-only (signup + sign-in + session). The management strategy
 * requires a `reset` configuration, so reset codes are configured — but
 * delivery is fail-closed in the spike (see `FailClosedDelivery` in
 * `yielded-live.ts`): attempting a reset fails with a delivery error instead
 * of silently going nowhere. Wiring a real transport is the follow-up.
 */
export const AppAuth = Auth.make(XsblxAuthApi, {
  strategies: {
    password: Password.make({
      registration: Registration,
      reset: Password.resetCode({}),
    }),
  },
  sessions: sessionConfiguration,
  defaultStrategy: "password",
});

export type AppAuthService = typeof AppAuth extends { readonly Service: infer S } ? S : never;
