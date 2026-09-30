ALTER TABLE `document_groups` ADD `display_name` text;--> statement-breakpoint
ALTER TABLE `document_groups` ADD `document_date` text;--> statement-breakpoint
ALTER TABLE `document_groups` ADD `folder_id` text;--> statement-breakpoint
ALTER TABLE `document_groups` ADD `filed_by` text;--> statement-breakpoint
ALTER TABLE `document_types` ADD `filing_rule` text;--> statement-breakpoint
ALTER TABLE `folders` ADD `rule_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `folders_rule_key_unique` ON `folders` (`rule_key`);