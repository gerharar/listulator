CREATE TABLE `list_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`title` text NOT NULL,
	`order_index` integer NOT NULL,
	`time_to_consume_minutes` integer NOT NULL,
	`time_to_consume_is_estimated` integer DEFAULT true NOT NULL,
	`external_ref` text,
	`year` integer,
	`group` text,
	`tags` text,
	`notes` text,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `list_snapshots_list_idx` ON `list_snapshots` (`list_id`);--> statement-breakpoint
ALTER TABLE `lists` ADD `source_yaml` text;--> statement-breakpoint
ALTER TABLE `lists` ADD `arrived_title` text;--> statement-breakpoint
ALTER TABLE `lists` ADD `arrived_description` text;--> statement-breakpoint
ALTER TABLE `lists` ADD `arrived_status` text;