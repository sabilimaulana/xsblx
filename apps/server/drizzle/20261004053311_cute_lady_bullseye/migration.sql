ALTER TABLE `user` RENAME COLUMN `name` TO `display_name`;--> statement-breakpoint
CREATE TABLE `__todos_keep` AS SELECT * FROM `todos`;--> statement-breakpoint
CREATE TABLE `__new_user` (
	`id` text PRIMARY KEY,
	`display_name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`security_revision` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_user`(`id`, `display_name`, `status`, `security_revision`, `created_at`, `updated_at`) SELECT `id`, `display_name`, `status`, `security_revision`, `created_at`, `updated_at` FROM `user`;--> statement-breakpoint
DROP TABLE `user`;--> statement-breakpoint
ALTER TABLE `__new_user` RENAME TO `user`;--> statement-breakpoint
INSERT INTO `todos` SELECT * FROM `__todos_keep`;--> statement-breakpoint
DROP TABLE `__todos_keep`;
