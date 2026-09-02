CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`is_default_local_user` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_one_default_local` ON `users` (`is_default_local_user`) WHERE "users"."is_default_local_user" = 1;