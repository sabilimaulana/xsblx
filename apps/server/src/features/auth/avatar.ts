import { blobatar } from "blobatar/blob";
import { S3Client } from "bun";
import { Effect } from "effect";
import { newId } from "../../id.ts";

/**
 * Avatars are generated at registration and stored as SVG in the object store
 * (ADR 0018). Like the rest of auth this runs outside the Effect runtime (ADR
 * 0007), so it reads `process.env` directly and uses Bun's own S3 client rather
 * than a `Context.Service` it could never be given.
 */
const bucket = process.env["S3_BUCKET"] ?? "xsblx";
const endpoint = process.env["S3_ENDPOINT"] ?? "http://localhost:8333";

/**
 * SeaweedFS addresses buckets path-style (`<endpoint>/<bucket>/<key>`), which is
 * Bun's default — `virtualHostedStyle` would resolve `xsblx.seaweedfs` and fail
 * DNS. `region` is unused by SeaweedFS but the SigV4 signer requires one.
 */
const s3 = new S3Client({
  endpoint,
  accessKeyId: process.env["S3_ACCESS_KEY"],
  secretAccessKey: process.env["S3_SECRET_KEY"],
  bucket,
  region: "us-east-1",
});

/**
 * The browser reaches the store directly, so the stored URL is built from the
 * origin a browser can resolve — inside compose the server talks to
 * `http://seaweedfs:8333`, which means nothing on the host.
 */
const publicBase = process.env["S3_PUBLIC_URL"] ?? endpoint;

/** Only `public/*` is anonymously readable; anything else needs a signature. */
export const avatarKey = (id: string): string => `public/avatars/${id}.svg`;

/**
 * A random blobatar, not one derived from the user: the seed is a fresh id, so
 * the same email address registered twice does not inherit the same face and
 * nothing about the user is recoverable from the avatar URL.
 *
 * Returns `null` when the store is unreachable — signing up is not held hostage
 * to a decorative asset. The column is nullable and the UI falls back to text.
 */
export const createAvatar = async (): Promise<string | null> => {
  const id = newId();
  const key = avatarKey(id);
  try {
    await s3.write(key, blobatar(id), { type: "image/svg+xml" });
  } catch (error) {
    // No fiber to log on out here, but the logger is still Effect's, not `console`.
    Effect.runSync(Effect.logWarning("avatar upload failed", error));
    return null;
  }
  return `${publicBase}/${bucket}/${key}`;
};
