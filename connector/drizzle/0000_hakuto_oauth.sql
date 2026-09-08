CREATE TABLE `oauth_codes` (
  `code_hash` text PRIMARY KEY NOT NULL,
  `client_id` text NOT NULL,
  `redirect_uri` text NOT NULL,
  `resource` text NOT NULL,
  `scope` text NOT NULL,
  `code_challenge` text NOT NULL,
  `email` text NOT NULL,
  `expires_at` integer NOT NULL,
  `used_at` integer
);
--> statement-breakpoint
CREATE TABLE `oauth_tokens` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `email` text NOT NULL,
  `scope` text NOT NULL,
  `token_type` text NOT NULL,
  `family_id` text NOT NULL,
  `expires_at` integer NOT NULL,
  `revoked_at` integer,
  `created_at` integer NOT NULL,
  CONSTRAINT `oauth_tokens_token_type_check` CHECK (`token_type` IN ('access', 'refresh'))
);
--> statement-breakpoint
CREATE INDEX `idx_oauth_codes_expires_at` ON `oauth_codes` (`expires_at`);
--> statement-breakpoint
CREATE INDEX `idx_oauth_tokens_expires_at` ON `oauth_tokens` (`expires_at`);
--> statement-breakpoint
CREATE INDEX `idx_oauth_tokens_family_id` ON `oauth_tokens` (`family_id`);
--> statement-breakpoint
PRAGMA optimize;
