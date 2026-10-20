CREATE TABLE `dots` (
	`name` text PRIMARY KEY NOT NULL,
	`directory` text NOT NULL,
	`session_id` text NOT NULL,
	`session_state` text NOT NULL,
	`created_at` integer NOT NULL
);
