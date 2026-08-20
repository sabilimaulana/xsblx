import { S3Client } from "bun";
import { describe, expect, it } from "bun:test";
import { createAvatar } from "./avatar.ts";

/**
 * What is worth testing here is not the SVG — blobatar has its own tests — but
 * the store's prefix rule (ADR 0018): `public/*` is readable by an unsigned
 * `<img src>`, and nothing outside it is. Both halves fail loudly if the
 * SeaweedFS identity config drifts.
 *
 * Runs under `bun test`, not vitest: vitest runs on node and this module imports
 * `bun`. Needs the object store from `docker compose up -d` and the `S3_*`
 * values in `.env.test`.
 */
const store = new S3Client({
  endpoint: process.env["S3_ENDPOINT"],
  accessKeyId: process.env["S3_ACCESS_KEY"],
  secretAccessKey: process.env["S3_SECRET_KEY"],
  bucket: process.env["S3_BUCKET"],
  region: "us-east-1",
});

const objectUrl = (key: string) =>
  `${process.env["S3_ENDPOINT"]}/${process.env["S3_BUCKET"]}/${key}`;

describe("createAvatar", () => {
  it("stores an SVG a browser can read unsigned", async () => {
    const url = await createAvatar();
    expect(url).not.toBeNull();

    const response = await fetch(url!);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(await response.text()).toContain("<svg");
  });

  it("does not open the rest of the bucket to anonymous readers", async () => {
    const key = "private/anonymous-read-probe.txt";
    await store.write(key, "not for the world");
    try {
      const response = await fetch(objectUrl(key));
      expect(response.status).toBe(403);
    } finally {
      await store.delete(key);
    }
  });
});
