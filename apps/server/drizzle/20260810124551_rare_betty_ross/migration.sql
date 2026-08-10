ALTER TABLE "todos" ADD COLUMN "userId" text NOT NULL;--> statement-breakpoint
CREATE INDEX "todos_userId_idx" ON "todos" ("userId");--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;