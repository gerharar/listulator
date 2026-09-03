CREATE TABLE `dismissed_items` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`external_ref` text,
	`title_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dismissed_items_list_idx` ON `dismissed_items` (`list_id`);