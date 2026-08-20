import type * as runtime from "@cloudflare/workers-types";
import { blobatar } from "blobatar/blob";
import { Effect } from "effect";
import { newId } from "../../id.ts";

/**
 * Avatars are generated at registration and stored as SVG in R2 (ADR 0021). Like
 * the rest of auth this runs outside the Effect runtime (ADR 0007) — it is called
 * from a Better Auth database hook — so it takes the native `R2Bucket` binding
 * and uses its promise API rather than a `Context.Service` it could never be
 * given.
 */

/** Only `public/*` is served anonymously; anything else has no read path. */
export const avatarKey = (id: string): string => `public/avatars/${id}.svg`;

/**
 * A random blobatar, not one derived from the user: the seed is a fresh id, so
 * the same email address registered twice does not inherit the same face and
 * nothing about the user is recoverable from the avatar URL.
 *
 * Returns `null` when the write fails — signing up is not held hostage to a
 * decorative asset. The column is nullable and the UI falls back to text.
 */
export const createAvatar = async (options: {
  readonly bucket: runtime.R2Bucket;
  readonly baseUrl: string;
}): Promise<string | null> => {
  const id = newId();
  const key = avatarKey(id);
  try {
    await options.bucket.put(key, blobatar(id), {
      httpMetadata: { contentType: "image/svg+xml" },
    });
  } catch (error) {
    // No fiber to log on out here, but the logger is still Effect's, not `console`.
    Effect.runSync(Effect.logWarning("avatar upload failed", error));
    return null;
  }
  // The browser fetches this from the API Worker, so the URL has to be absolute:
  // the web app is a different origin.
  return `${options.baseUrl}/${key}`;
};
