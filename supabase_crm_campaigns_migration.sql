-- Run this in the Supabase SQL Editor (project: pjhwgnhtiovshoulpgeh)

-- 1. Create the crm_campaigns table
CREATE TABLE IF NOT EXISTS crm_campaigns (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  notes       TEXT,
  color       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Add campaign_id FK to crm_properties
ALTER TABLE crm_properties
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES crm_campaigns(id) ON DELETE SET NULL;

-- 3. Index for fast campaign-filtered property queries
CREATE INDEX IF NOT EXISTS idx_crm_properties_campaign_id ON crm_properties(campaign_id);
