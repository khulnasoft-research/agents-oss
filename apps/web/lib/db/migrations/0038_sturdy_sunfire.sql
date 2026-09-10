CREATE TABLE "custom_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"api_key" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custom_providers" ADD CONSTRAINT "custom_providers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_providers_user_id_idx" ON "custom_providers" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_providers_user_name_idx" ON "custom_providers" USING btree ("user_id","name");