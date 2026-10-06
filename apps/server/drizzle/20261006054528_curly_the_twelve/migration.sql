CREATE TABLE `xsblx_auth_password_attempt_charges` (
	`id` text PRIMARY KEY,
	`module_id` text NOT NULL,
	`action` text NOT NULL,
	`scope` text NOT NULL,
	`key` text NOT NULL,
	`occurred_at` integer NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS `xsblx_auth_passwordCharges_key_0`;--> statement-breakpoint
DROP INDEX IF EXISTS `xsblx_auth_passwordScopes_key_0`;--> statement-breakpoint
CREATE INDEX `xsblx_auth_password_attempt_charges_key_idx` ON `xsblx_auth_password_attempt_charges` (`module_id`,`action`,`scope`,`key`,`occurred_at`);--> statement-breakpoint
DROP TABLE `xsblx_auth_passwordCharges`;--> statement-breakpoint
DROP TABLE `xsblx_auth_passwordScopes`;