DROP INDEX "todos_userId_id_idx";--> statement-breakpoint
-- The identity has to go first: Postgres refuses to retype a column while a
-- sequence is still attached to it.
ALTER TABLE "todos" ALTER COLUMN "id" DROP IDENTITY;--> statement-breakpoint
ALTER TABLE "todos" ALTER COLUMN "id" SET DATA TYPE text USING "id"::text;--> statement-breakpoint
ALTER TABLE "todos" ALTER COLUMN "createdAt" SET DATA TYPE timestamp(3) with time zone USING "createdAt"::timestamp(3) with time zone;--> statement-breakpoint
-- Rows that predate the change carry a serial id cast to text, which fails the
-- API's 21-character check on the way out. Rewrite them into the new shape.
-- Hex digits are a subset of the id alphabet, and md5 is injective enough here
-- that distinct old ids stay distinct — this backfills legacy rows, it never
-- mints an id the application will go on to use.
UPDATE "todos" SET "id" = substr(md5("id"), 1, 21)
WHERE length("id") <> 21;--> statement-breakpoint
CREATE INDEX "todos_userId_createdAt_id_idx" ON "todos" ("userId","createdAt" DESC NULLS LAST,"id" DESC NULLS LAST);