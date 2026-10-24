-- Rows of a list that is no longer there (BL-137): no screen can reach them, and the foreign keys should have taken them with the list.
DELETE FROM `list_items` WHERE `list_id` NOT IN (SELECT `id` FROM `lists`);--> statement-breakpoint
DELETE FROM `list_groups` WHERE `list_id` NOT IN (SELECT `id` FROM `lists`);--> statement-breakpoint
DELETE FROM `list_snapshots` WHERE `list_id` NOT IN (SELECT `id` FROM `lists`);--> statement-breakpoint
DELETE FROM `dismissed_items` WHERE `list_id` NOT IN (SELECT `id` FROM `lists`);
