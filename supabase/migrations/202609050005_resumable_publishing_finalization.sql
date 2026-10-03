-- Persist the finalized private artifact so large-media submission can resume
-- after a gateway timeout without uploading again or creating duplicate jobs.
alter table agentic_that.publishing_staged_uploads
  add column if not exists artifact_manifest jsonb,
  add column if not exists finalized_at timestamptz;

