CREATE TABLE `workers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dot` text NOT NULL,
	`task` text NOT NULL,
	`directory` text NOT NULL,
	`session_id` text NOT NULL,
	`state` text NOT NULL,
	`prompt_id` text,
	`outcome` text,
	`waiting_on` text,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`dot`) REFERENCES `dots`(`name`) ON UPDATE no action ON DELETE no action
);
