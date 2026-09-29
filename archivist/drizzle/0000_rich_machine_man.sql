CREATE TABLE `agent_events` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text,
	`document_id` text,
	`batch_id` text,
	`agent` text,
	`kind` text NOT NULL,
	`tool_name` text,
	`data` text,
	`message` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `capture_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`device` text,
	`status` text DEFAULT 'live' NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`expected_pages` integer,
	`summary` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `document_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`document_type_id` text,
	`title` text NOT NULL,
	`grouping_key` text,
	`expected_count` integer,
	`received_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'incomplete' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `document_types` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`field_schema` text NOT NULL,
	`expected_docs_per_group` integer,
	`created_by` text DEFAULT 'agent' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_types_name_unique` ON `document_types` (`name`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`storage_path` text NOT NULL,
	`source` text DEFAULT 'web' NOT NULL,
	`status` text DEFAULT 'uploaded' NOT NULL,
	`title` text,
	`summary` text,
	`ocr_text` text,
	`document_type_id` text,
	`group_id` text,
	`folder_id` text,
	`extracted_fields` text,
	`batch_id` text,
	`capture_id` text,
	`page_number` integer,
	`captured_at` integer,
	`sha256` text,
	`capture_meta` text,
	`confidence` real,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `folders` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`description` text,
	`created_by` text DEFAULT 'agent' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`document_id` text,
	`batch_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `phone_uploads` (
	`batch_id` text NOT NULL,
	`item_id` text NOT NULL,
	`kind` text NOT NULL,
	`sha256` text NOT NULL,
	`bytes` integer NOT NULL,
	`storage_path` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`batch_id`, `item_id`, `kind`)
);
--> statement-breakpoint
CREATE TABLE `voice_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`clip_id` text NOT NULL,
	`t_start` integer NOT NULL,
	`t_end` integer NOT NULL,
	`storage_path` text NOT NULL,
	`transcript` text,
	`kind` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `voice_notes_batch_clip` ON `voice_notes` (`batch_id`,`clip_id`);