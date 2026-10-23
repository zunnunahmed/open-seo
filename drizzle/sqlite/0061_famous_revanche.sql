CREATE TABLE `outreach_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`prospect_id` text NOT NULL,
	`email` text NOT NULL,
	`first_name` text,
	`last_name` text,
	`title` text,
	`linkedin_url` text,
	`found_via` text NOT NULL,
	`verification` text DEFAULT 'unverified' NOT NULL,
	`verified_at` text,
	`instantly_campaign_id` text,
	`sent_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`prospect_id`) REFERENCES `outreach_prospects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outreach_contacts_project_email_unique` ON `outreach_contacts` (`project_id`,`email`);--> statement-breakpoint
CREATE INDEX `outreach_contacts_prospect_idx` ON `outreach_contacts` (`prospect_id`);--> statement-breakpoint
CREATE TABLE `outreach_prospects` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`domain` text NOT NULL,
	`source` text NOT NULL,
	`source_detail` text,
	`source_url` text,
	`source_title` text,
	`authority` integer,
	`status` text DEFAULT 'new' NOT NULL,
	`contacts_checked_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outreach_prospects_project_domain_source_unique` ON `outreach_prospects` (`project_id`,`domain`,`source`);--> statement-breakpoint
CREATE INDEX `outreach_prospects_project_created_idx` ON `outreach_prospects` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `outreach_suppressions` (
	`project_id` text NOT NULL,
	`value` text NOT NULL,
	`reason` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	PRIMARY KEY(`project_id`, `value`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
