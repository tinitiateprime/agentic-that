-- Move AI Website Studio into the customer Store authorization model.
-- Website content remains server-only; these grants control access to the
-- Store card, workspace UI, and authenticated generation API.

insert into public.rbac_roles
  (id, name, description, is_system, is_self_selectable)
values
  ('role_self_website', 'AI Website Studio access',
   'Generate, deliver, and publish complete AI-created business websites.', true, true),
  ('role_website_viewer', 'Website Viewer',
   'Views AI Website Studio projects and delivery status.', true, false),
  ('role_website_creator', 'Website Creator',
   'Creates, delivers, retries, and monitors AI-generated websites.', true, false),
  ('role_website_manager', 'Website Manager',
   'Full AI Website Studio operations and configuration.', true, false)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  is_system = excluded.is_system,
  is_self_selectable = excluded.is_self_selectable,
  updated_at = now();

update public.rbac_roles
   set description = 'All currently live AI Website, Messaging, Publishing, and Scraping modules.',
       updated_at = now()
 where id = 'role_self_full_access';

insert into public.rbac_role_grants (role_id, resource_key, access_level)
values
  ('role_self_website', 'website', 'configure'),
  ('role_self_full_access', 'website', 'configure'),
  ('role_legacy_full_access', 'website', 'configure'),
  ('role_workspace_owner', 'website.view', 'operate'),
  ('role_workspace_owner', 'website.generate', 'operate'),
  ('role_workspace_owner', 'website.configure', 'operate'),
  ('role_website_viewer', 'website.view', 'operate'),
  ('role_website_creator', 'website.view', 'operate'),
  ('role_website_creator', 'website.generate', 'operate'),
  ('role_website_manager', 'website.view', 'operate'),
  ('role_website_manager', 'website.generate', 'operate'),
  ('role_website_manager', 'website.configure', 'operate')
on conflict (role_id, resource_key) do update set
  access_level = excluded.access_level;
