CREATE TABLE `outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`message_id` text NOT NULL,
	`text` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbox_message_id_unique` ON `outbox` (`message_id`);--> statement-breakpoint
INSERT INTO `outbox` (`session_id`, `message_id`, `text`, `state`, `created_at`)
SELECT `dots`.`session_id`, `reminders`.`message_id`, 'Reminder you scheduled:' || char(10) || char(10) || `reminders`.`text`, 'pending', `reminders`.`due_at`
FROM `reminders` JOIN `dots` ON `dots`.`name` = `reminders`.`dot`
WHERE `reminders`.`state` = 'delivering' AND `reminders`.`message_id` IS NOT NULL;--> statement-breakpoint
UPDATE `reminders` SET `state` = 'sent' WHERE `state` = 'delivering';--> statement-breakpoint
ALTER TABLE `reminders` DROP COLUMN `message_id`;