CREATE TABLE `notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dot` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`dot`) REFERENCES `dots`(`name`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dot` text NOT NULL,
	`text` text NOT NULL,
	`due_at` integer NOT NULL,
	`state` text NOT NULL,
	`message_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`dot`) REFERENCES `dots`(`name`) ON UPDATE no action ON DELETE no action
);
