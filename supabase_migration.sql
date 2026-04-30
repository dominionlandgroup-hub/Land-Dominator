-- ============================================================
-- Land Dominator CRM — Supabase Migration
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- ── Properties ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crm_properties (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Core
  apn             TEXT,
  county          TEXT,
  state           TEXT,
  acreage         NUMERIC,
  status          TEXT NOT NULL DEFAULT 'lead',

  -- Owner
  owner_full_name       TEXT,
  owner_first_name      TEXT,
  owner_last_name       TEXT,
  owner_phone           TEXT,
  owner_email           TEXT,
  owner_mailing_address TEXT,

  -- Campaign
  campaign_code   TEXT,
  campaign_price  NUMERIC,
  offer_price     NUMERIC,

  -- Sale / Purchase
  sale_date       DATE,
  sale_price      NUMERIC,
  purchase_date   DATE,
  purchase_price  NUMERIC,

  -- Due Diligence
  dd_access       TEXT,
  dd_topography   TEXT,
  dd_flood_zone   TEXT,
  dd_sewer        TEXT,
  dd_septic       TEXT,
  dd_water        TEXT,
  dd_power        TEXT,
  dd_zoning       TEXT,
  dd_back_taxes   TEXT,

  -- Comparables
  comp1_link      TEXT,
  comp1_price     NUMERIC,
  comp1_acreage   NUMERIC,
  comp2_link      TEXT,
  comp2_price     NUMERIC,
  comp2_acreage   NUMERIC,
  comp3_link      TEXT,
  comp3_price     NUMERIC,
  comp3_acreage   NUMERIC,

  -- Marketing
  marketing_price         NUMERIC,
  marketing_title         TEXT,
  marketing_description   TEXT,
  marketing_nearest_city  TEXT,

  -- Pricing
  ghl_offer_code      TEXT,
  lp_estimate         NUMERIC,
  offer_range_high    NUMERIC,
  pricing_offer_price NUMERIC,
  pebble_code         TEXT,
  claude_ai_comp      NUMERIC,

  -- Arrays
  tags              TEXT[],
  additional_phones TEXT[],
  notes             TEXT
);

-- ── Contacts ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crm_contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_name      TEXT,
  last_name       TEXT,
  full_name       TEXT,
  email           TEXT,
  phone           TEXT,
  mailing_address TEXT,
  city            TEXT,
  state           TEXT,
  zip             TEXT,
  notes           TEXT,
  tags            TEXT[],
  property_ids    UUID[]
);

-- ── Deals ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crm_deals (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  title                TEXT NOT NULL,
  property_id          UUID REFERENCES crm_properties(id) ON DELETE SET NULL,
  contact_id           UUID REFERENCES crm_contacts(id)  ON DELETE SET NULL,
  stage                TEXT NOT NULL DEFAULT 'lead'
                         CHECK (stage IN (
                           'lead','prospect','offer_sent',
                           'under_contract','due_diligence',
                           'closed_won','closed_lost'
                         )),
  value                NUMERIC,
  notes                TEXT,
  expected_close_date  DATE,
  tags                 TEXT[]
);

-- ── Auto-update trigger ─────────────────────────────────────

CREATE OR REPLACE FUNCTION crm_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER crm_properties_updated_at
  BEFORE UPDATE ON crm_properties
  FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();

CREATE TRIGGER crm_contacts_updated_at
  BEFORE UPDATE ON crm_contacts
  FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();

CREATE TRIGGER crm_deals_updated_at
  BEFORE UPDATE ON crm_deals
  FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();

-- ── Row-Level Security ──────────────────────────────────────
-- Adjust these policies to match your auth strategy.
-- Currently allows all operations (service-role key bypasses RLS).

ALTER TABLE crm_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contacts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_deals      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_properties_all" ON crm_properties FOR ALL USING (true);
CREATE POLICY "crm_contacts_all"   ON crm_contacts   FOR ALL USING (true);
CREATE POLICY "crm_deals_all"      ON crm_deals       FOR ALL USING (true);

-- ── Indexes ─────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_crm_properties_status  ON crm_properties (status);
CREATE INDEX IF NOT EXISTS idx_crm_properties_state   ON crm_properties (state);
CREATE INDEX IF NOT EXISTS idx_crm_properties_county  ON crm_properties (county);
CREATE INDEX IF NOT EXISTS idx_crm_properties_apn     ON crm_properties (apn);
CREATE INDEX IF NOT EXISTS idx_crm_deals_stage        ON crm_deals (stage);
