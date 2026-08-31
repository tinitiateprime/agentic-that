-- Run as the Supabase database owner only after 0001_production_pilot.sql.
-- psql prompts for the value; no password is stored in this repository:
--   psql "$SUPABASE_ADMIN_DATABASE_URL" \
--     --set=automation_password="$(openssl rand -base64 36)" \
--     --file deploy/supabase/create-automation-login.sql

\if :{?automation_password}
\else
  \echo 'automation_password is required'
  \quit
\endif

DO $bootstrap$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agenticthat_automation_login') THEN
    CREATE ROLE agenticthat_automation_login LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END
$bootstrap$;

ALTER ROLE agenticthat_automation_login PASSWORD :'automation_password';
GRANT agenticthat_automation TO agenticthat_automation_login;
ALTER ROLE agenticthat_automation_login SET statement_timeout = '15min';
ALTER ROLE agenticthat_automation_login SET lock_timeout = '10s';
ALTER ROLE agenticthat_automation_login SET search_path = public, pg_temp;
