import * as Cloudflare from "alchemy/Cloudflare";

/**
 * The one bucket for user-facing assets (ADR 0021). A new kind of asset is a new
 * key prefix under `public/`, never a second bucket.
 *
 * The bucket itself is private: R2 only serves objects anonymously through a
 * custom domain, and this stack owns no zone, so `GET /public/*` on the API
 * Worker is the read path (`features/auth/http.ts`).
 */
export const Assets = Cloudflare.R2.Bucket("Assets");
