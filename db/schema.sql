-- Run once through `pnpm db:migrate` or the Supabase SQL editor.
-- Idempotent installation; private workspace tables are not in public.
CREATE SCHEMA IF NOT EXISTS permitline_dashboard;
REVOKE ALL ON SCHEMA permitline_dashboard FROM PUBLIC;

CREATE TABLE IF NOT EXISTS permitline_dashboard.workspace_accounts (
  user_id text PRIMARY KEY,
  password_hash text NOT NULL,
  password_salt text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  lock_until bigint NOT NULL DEFAULT 0,
  created_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS permitline_dashboard.workspace_sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES permitline_dashboard.workspace_accounts(user_id) ON DELETE CASCADE,
  expires_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS permitline_dashboard.workspace_preferences (
  user_id text PRIMARY KEY REFERENCES permitline_dashboard.workspace_accounts(user_id) ON DELETE CASCADE,
  payload text NOT NULL,
  updated_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS permitline_dashboard.lead_states (
  user_id text NOT NULL REFERENCES permitline_dashboard.workspace_accounts(user_id) ON DELETE CASCADE,
  permit_id text NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'saved', 'contacted', 'won', 'dismissed')),
  notes text NOT NULL DEFAULT '',
  updated_at bigint NOT NULL,
  PRIMARY KEY (user_id, permit_id)
);
CREATE TABLE IF NOT EXISTS permitline_dashboard.jev_assessments (
  user_id text NOT NULL REFERENCES permitline_dashboard.workspace_accounts(user_id) ON DELETE CASCADE,
  permit_id text NOT NULL,
  input_hash text NOT NULL,
  payload text NOT NULL,
  created_at bigint NOT NULL,
  PRIMARY KEY (user_id, permit_id)
);

ALTER TABLE permitline_dashboard.workspace_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE permitline_dashboard.workspace_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE permitline_dashboard.workspace_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE permitline_dashboard.lead_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE permitline_dashboard.jev_assessments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA permitline_dashboard FROM PUBLIC;

-- No client policies: access is exclusively through password-protected routes.
-- The server connection must use the schema owner (normally postgres).
DO $permissions$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA permitline_dashboard FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA permitline_dashboard FROM %I', role_name);
    END IF;
  END LOOP;
END
$permissions$;
