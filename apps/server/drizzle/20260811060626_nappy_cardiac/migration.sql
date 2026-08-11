DROP INDEX "todos_userId_idx";--> statement-breakpoint
CREATE INDEX "todos_userId_id_idx" ON "todos" ("userId","id" DESC NULLS LAST);