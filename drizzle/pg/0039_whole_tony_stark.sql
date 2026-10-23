CREATE TABLE "outreach_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"prospect_id" text NOT NULL,
	"email" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"title" text,
	"linkedin_url" text,
	"found_via" text NOT NULL,
	"verification" text DEFAULT 'unverified' NOT NULL,
	"verified_at" text,
	"instantly_campaign_id" text,
	"sent_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_prospects" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"domain" text NOT NULL,
	"source" text NOT NULL,
	"source_detail" text,
	"source_url" text,
	"source_title" text,
	"authority" integer,
	"status" text DEFAULT 'new' NOT NULL,
	"contacts_checked_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_suppressions" (
	"project_id" text NOT NULL,
	"value" text NOT NULL,
	"reason" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "outreach_suppressions_project_id_value_pk" PRIMARY KEY("project_id","value")
);
--> statement-breakpoint
ALTER TABLE "outreach_contacts" ADD CONSTRAINT "outreach_contacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_contacts" ADD CONSTRAINT "outreach_contacts_prospect_id_outreach_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."outreach_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_prospects" ADD CONSTRAINT "outreach_prospects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_suppressions" ADD CONSTRAINT "outreach_suppressions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_contacts_project_email_unique" ON "outreach_contacts" USING btree ("project_id","email");--> statement-breakpoint
CREATE INDEX "outreach_contacts_prospect_idx" ON "outreach_contacts" USING btree ("prospect_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_prospects_project_domain_source_unique" ON "outreach_prospects" USING btree ("project_id","domain","source");--> statement-breakpoint
CREATE INDEX "outreach_prospects_project_created_idx" ON "outreach_prospects" USING btree ("project_id","created_at");