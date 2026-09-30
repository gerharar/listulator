ALTER TABLE `lists` ADD `snapshot_fetched_at` integer;--> statement-breakpoint
UPDATE `lists` SET `snapshot_fetched_at` = `created_at` WHERE `media_type` <> 'mega' AND (`arrived_title` IS NOT NULL OR `id` IN (SELECT `list_id` FROM `list_snapshots`));
