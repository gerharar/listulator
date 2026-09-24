CREATE TABLE `list_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`name` text NOT NULL,
	`order_index` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `list_groups_list_name` ON `list_groups` (`list_id`,`name`);--> statement-breakpoint
-- Backfill (D3): one group per distinct label per list, numbered in the order
-- each label first appears, so today's visual order is preserved.
INSERT INTO `list_groups` (`id`, `list_id`, `name`, `order_index`, `created_at`, `updated_at`)
SELECT
	lower(hex(randomblob(16))),
	`list_id`,
	`group`,
	ROW_NUMBER() OVER (PARTITION BY `list_id` ORDER BY `first_index`, `group`) - 1,
	CAST(strftime('%s', 'now') AS integer) * 1000,
	CAST(strftime('%s', 'now') AS integer) * 1000
FROM (
	SELECT `list_id`, `group`, MIN(`order_index`) AS `first_index`
	FROM `list_items`
	WHERE `group` IS NOT NULL AND `group` <> ''
	GROUP BY `list_id`, `group`
);
