# Automation PostgreSQL migrations

Run these files in lexical order with the dedicated migration database role.
Application processes only verify the recorded migration key; they do not run
DDL during production startup.

After migration, run `deploy/supabase/create-automation-login.sql` as the
database owner and use the resulting `agenticthat_automation_login` connection
for the runtime Web App. The runtime login can read the migration marker and
perform application DML, but it cannot create schema objects.

For Supabase, use the direct database connection for migrations. Use the
session pooler for the long-running automation Web App when direct IPv6
connectivity is not available.
