CREATE TYPE "public"."procedure_consumption_status" AS ENUM('pending', 'consumed', 'skipped');--> statement-breakpoint
CREATE TABLE "procedure_consumptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"performed_procedure_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" "procedure_consumption_status" DEFAULT 'pending' NOT NULL,
	"note" text,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "procedure_consumptions_quantity_positive" CHECK ("procedure_consumptions"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "service_consumables" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_consumables_quantity_positive" CHECK ("service_consumables"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "performed_procedure_id" uuid;--> statement-breakpoint
ALTER TABLE "procedure_consumptions" ADD CONSTRAINT "procedure_consumptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_consumptions" ADD CONSTRAINT "procedure_consumptions_performed_procedure_id_performed_procedures_id_fk" FOREIGN KEY ("performed_procedure_id") REFERENCES "public"."performed_procedures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_consumptions" ADD CONSTRAINT "procedure_consumptions_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_consumptions" ADD CONSTRAINT "procedure_consumptions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_consumptions" ADD CONSTRAINT "procedure_consumptions_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_consumables" ADD CONSTRAINT "service_consumables_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_consumables" ADD CONSTRAINT "service_consumables_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_consumables" ADD CONSTRAINT "service_consumables_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_consumables" ADD CONSTRAINT "service_consumables_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "procedure_consumptions_proc_item_uq" ON "procedure_consumptions" USING btree ("performed_procedure_id","item_id");--> statement-breakpoint
CREATE INDEX "procedure_consumptions_status_idx" ON "procedure_consumptions" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "service_consumables_service_item_uq" ON "service_consumables" USING btree ("organization_id","service_id","item_id");--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_performed_procedure_id_performed_procedures_id_fk" FOREIGN KEY ("performed_procedure_id") REFERENCES "public"."performed_procedures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_movements_procedure_idx" ON "inventory_movements" USING btree ("organization_id","performed_procedure_id");