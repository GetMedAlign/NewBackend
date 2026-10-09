CREATE TABLE "location" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug"            TEXT NOT NULL,
    "name"            TEXT NOT NULL,
    "state_code"      TEXT NOT NULL,
    "status"          TEXT NOT NULL DEFAULT 'hidden',
    "area"            TEXT NOT NULL DEFAULT '',
    "intro"           TEXT NOT NULL DEFAULT '',
    "seo_title"       TEXT NOT NULL DEFAULT '',
    "seo_description" TEXT NOT NULL DEFAULT '',
    "display_order"   INTEGER NOT NULL DEFAULT 0,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "location_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "location_status_check" CHECK ("status" IN ('available','coming_soon','hidden'))
);
CREATE UNIQUE INDEX "location_slug_key" ON "location"("slug");

CREATE TABLE "location_alias" (
    "location_id" UUID NOT NULL,
    "alias"       TEXT NOT NULL,
    CONSTRAINT "location_alias_pkey" PRIMARY KEY ("location_id","alias"),
    CONSTRAINT "location_alias_location_fkey" FOREIGN KEY ("location_id") REFERENCES "location"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "location_near" (
    "location_id"   UUID NOT NULL,
    "near_slug"     TEXT NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "location_near_pkey" PRIMARY KEY ("location_id","near_slug"),
    CONSTRAINT "location_near_location_fkey" FOREIGN KEY ("location_id") REFERENCES "location"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "marketing_service" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug"            TEXT NOT NULL,
    "name"            TEXT NOT NULL,
    "description"     TEXT NOT NULL DEFAULT '',
    "status"          TEXT NOT NULL DEFAULT 'active',
    "seo_title"       TEXT NOT NULL DEFAULT '',
    "seo_description" TEXT NOT NULL DEFAULT '',
    "display_order"   INTEGER NOT NULL DEFAULT 0,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "marketing_service_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketing_service_status_check" CHECK ("status" IN ('active','hidden'))
);
CREATE UNIQUE INDEX "marketing_service_slug_key" ON "marketing_service"("slug");

CREATE TABLE "marketing_service_code" (
    "marketing_service_id" UUID NOT NULL,
    "service_code"         TEXT NOT NULL,
    CONSTRAINT "marketing_service_code_pkey" PRIMARY KEY ("marketing_service_id","service_code"),
    CONSTRAINT "marketing_service_code_service_fkey" FOREIGN KEY ("marketing_service_id") REFERENCES "marketing_service"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "marketing_service_code_code_idx" ON "marketing_service_code"("service_code");

CREATE TABLE "marketing_service_related" (
    "marketing_service_id" UUID NOT NULL,
    "related_slug"         TEXT NOT NULL,
    "display_order"        INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "marketing_service_related_pkey" PRIMARY KEY ("marketing_service_id","related_slug"),
    CONSTRAINT "marketing_service_related_service_fkey" FOREIGN KEY ("marketing_service_id") REFERENCES "marketing_service"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "localization_setting" (
    "id"          TEXT NOT NULL DEFAULT 'default',
    "min_clinics" INTEGER NOT NULL DEFAULT 2,
    "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "localization_setting_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "localization_setting_singleton_check" CHECK ("id" = 'default'),
    CONSTRAINT "localization_setting_min_check" CHECK ("min_clinics" >= 1)
);

CREATE TABLE "location_notify" (
    "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
    "email"      TEXT NOT NULL,
    "city_slug"  TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "location_notify_pkey" PRIMARY KEY ("id")
);
