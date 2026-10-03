-- Add client-facing product introductions without changing the existing
-- secure workspace invitation flow.

alter table public.notification_templates
  drop constraint if exists notification_templates_purpose_check;

alter table public.notification_templates
  add constraint notification_templates_purpose_check
  check (purpose in ('workspace_invitation', 'product_invitation'));

alter table public.notification_deliveries
  alter column invitation_id drop not null;

alter table public.notification_deliveries
  add column if not exists purpose text not null default 'workspace_invitation',
  add column if not exists product_key text,
  add column if not exists product_name text,
  add column if not exists product_description text,
  add column if not exists product_url text,
  add column if not exists sender_id text,
  add column if not exists sender_from text;

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_purpose_check;

alter table public.notification_deliveries
  add constraint notification_deliveries_purpose_check
  check (purpose in ('workspace_invitation', 'product_invitation'));

alter table public.notification_deliveries
  add constraint notification_deliveries_purpose_fields_check
  check (
    (purpose = 'workspace_invitation' and invitation_id is not null)
    or
    (purpose = 'product_invitation'
      and product_key is not null
      and product_name is not null
      and product_url is not null
      and sender_id is not null
      and sender_from is not null)
  );

create index if not exists notification_deliveries_purpose_recent_idx
  on public.notification_deliveries (purpose, queued_at desc);
