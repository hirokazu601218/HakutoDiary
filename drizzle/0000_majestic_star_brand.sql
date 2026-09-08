CREATE TABLE `auth_attempts` (
	`client_key` text PRIMARY KEY NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`window_started_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `diary_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`diary_date` text NOT NULL,
	`daycare_reply` text DEFAULT '' NOT NULL,
	`parent_message` text DEFAULT '' NOT NULL,
	`source_type` text DEFAULT 'text' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_diary_entries_date` ON `diary_entries` (`diary_date`);