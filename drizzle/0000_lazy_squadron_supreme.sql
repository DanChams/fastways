CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`date` text NOT NULL,
	`project` text NOT NULL,
	`status` text NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`drive` text DEFAULT '' NOT NULL,
	`assets` text DEFAULT '[]' NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
