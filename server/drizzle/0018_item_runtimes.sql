CREATE TABLE `item_runtimes` (
	`ref` text PRIMARY KEY NOT NULL,
	`minutes` integer,
	`fetched_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `item_runtimes_expires_idx` ON `item_runtimes` (`expires_at`);