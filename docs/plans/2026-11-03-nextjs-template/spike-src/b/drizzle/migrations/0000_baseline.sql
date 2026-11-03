CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_title_check" CHECK (char_length("items"."title") >= 1 AND char_length("items"."title") <= 200)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" "bytea" PRIMARY KEY NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_token_hash_check" CHECK (octet_length("sessions"."token_hash") = 32)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"is_disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_account_key" UNIQUE("account"),
	CONSTRAINT "users_account_check" CHECK (("users"."account" = lower("users"."account")) AND (char_length("users"."account") >= 3 AND char_length("users"."account") <= 50)),
	CONSTRAINT "users_role_check" CHECK ("users"."role" = ANY (ARRAY['admin'::text, 'user'::text]))
);
--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "items_owner_id_id_idx" ON "items" USING btree ("owner_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_id_key" ON "sessions" USING btree ("id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_id_idx" ON "sessions" USING btree ("user_id","id" DESC NULLS LAST);