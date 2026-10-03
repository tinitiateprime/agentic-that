-- Keyword group rules. Inbound WhatsApp messages are matched against a
-- business's rules by a trigger, so every write path -- the Meta, WATI and
-- Baileys webhooks, and the WATI history sync -- feeds the same automation
-- instead of each one remembering to call it.

create table if not exists public.whatsapp_group_rules (
  id              serial primary key,
  business_id     integer not null references public.businesses(id) on delete cascade,
  name            text not null,
  keywords        text[] not null check (cardinality(keywords) > 0),
  min_occurrences integer not null default 1 check (min_occurrences between 1 and 100),
  window_days     integer not null default 7 check (window_days between 1 and 365),
  enabled         boolean not null default true,
  -- The group is created on the first match, so a rule that never matches
  -- leaves no empty group behind.
  group_id        integer references public.groups(id) on delete set null,
  matched_count   integer not null default 0,
  last_matched_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists whatsapp_group_rules_name_idx
  on public.whatsapp_group_rules(business_id, lower(name));
create index if not exists whatsapp_group_rules_business_idx
  on public.whatsapp_group_rules(business_id) where enabled;
-- Rule backfill scans one business's recent inbound messages.
create index if not exists idx_messages_business_created
  on public.messages(business_id, created_at);

-- Keywords are matched whole-word and case-insensitively, so "price" does not
-- match "priceless" while the phrase "order status" still matches. Regex
-- metacharacters in a keyword are escaped: keywords are user input.
create or replace function public.whatsapp_group_rule_pattern(keywords text[])
returns text
language sql
immutable
as $$
  select '\m(' || string_agg(regexp_replace(btrim(keyword), '([\\^$.|?*+()\[\]{}-])', '\\\1', 'g'), '|') || ')\M'
    from unnest(keywords) AS keyword
   where btrim(keyword) <> ''
$$;

-- Adds one contact to a rule's group when their recent inbound messages reach
-- the rule's threshold. Returns true only when the contact was newly added.
create or replace function public.whatsapp_apply_group_rule(p_rule_id integer, p_contact_id integer)
returns boolean
language plpgsql
as $$
declare
  rule          public.whatsapp_group_rules;
  pattern       text;
  hits          integer;
  target_group  integer;
  added         integer;
begin
  -- Locking the rule row keeps two concurrent inbound messages from creating
  -- the group twice.
  select * into rule from public.whatsapp_group_rules where id = p_rule_id for update;
  if not found or not rule.enabled then return false; end if;

  pattern := public.whatsapp_group_rule_pattern(rule.keywords);
  if pattern is null then return false; end if;

  select count(*) into hits
    from public.messages message
   where message.contact_id = p_contact_id
     and message.business_id = rule.business_id
     and message.direction = 'in'
     and message.created_at >= now() - make_interval(days => rule.window_days)
     and message.body ~* pattern;
  if hits < rule.min_occurrences then return false; end if;

  target_group := rule.group_id;
  if target_group is null then
    insert into public.groups (business_id, name)
    values (rule.business_id, rule.name)
    returning id into target_group;
    update public.whatsapp_group_rules
       set group_id = target_group, updated_at = now()
     where id = rule.id;
  end if;

  insert into public.group_members (group_id, contact_id)
  values (target_group, p_contact_id)
  on conflict do nothing;
  get diagnostics added = row_count;
  if added = 0 then return false; end if;

  update public.whatsapp_group_rules
     set matched_count = matched_count + 1, last_matched_at = now()
   where id = rule.id;
  return true;
end;
$$;

-- Applies a rule to the messages already in its window, so a new rule picks up
-- the recent conversation instead of only future messages.
create or replace function public.whatsapp_backfill_group_rule(p_rule_id integer)
returns integer
language plpgsql
as $$
declare
  rule       public.whatsapp_group_rules;
  pattern    text;
  contact    record;
  additions  integer := 0;
begin
  select * into rule from public.whatsapp_group_rules where id = p_rule_id;
  if not found or not rule.enabled then return 0; end if;
  pattern := public.whatsapp_group_rule_pattern(rule.keywords);
  if pattern is null then return 0; end if;

  for contact in
    select message.contact_id
      from public.messages message
     where message.business_id = rule.business_id
       and message.direction = 'in'
       and message.created_at >= now() - make_interval(days => rule.window_days)
       and message.body ~* pattern
     group by message.contact_id
    having count(*) >= rule.min_occurrences
  loop
    if public.whatsapp_apply_group_rule(rule.id, contact.contact_id) then
      additions := additions + 1;
    end if;
  end loop;
  return additions;
end;
$$;

create or replace function public.whatsapp_group_rules_on_message()
returns trigger
language plpgsql
as $$
declare
  rule public.whatsapp_group_rules;
begin
  if new.direction <> 'in' or coalesce(new.body, '') = '' then return null; end if;

  -- Grouping is an enhancement: a failing rule must never reject the message
  -- that a webhook is delivering.
  begin
    for rule in
      select * from public.whatsapp_group_rules
       where business_id = new.business_id and enabled
    loop
      if new.body ~* public.whatsapp_group_rule_pattern(rule.keywords) then
        perform public.whatsapp_apply_group_rule(rule.id, new.contact_id);
      end if;
    end loop;
  exception when others then
    raise warning 'WhatsApp group rules skipped for message %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists messages_apply_group_rules on public.messages;
create trigger messages_apply_group_rules
  after insert on public.messages
  for each row
  execute function public.whatsapp_group_rules_on_message();

-- A new or re-tuned rule is applied to the recent messages immediately. The
-- column list excludes group_id/matched_count/last_matched_at, which the apply
-- function itself writes, so this never re-enters.
create or replace function public.whatsapp_group_rules_on_change()
returns trigger
language plpgsql
as $$
begin
  perform public.whatsapp_backfill_group_rule(new.id);
  return null;
end;
$$;

drop trigger if exists whatsapp_group_rules_backfill on public.whatsapp_group_rules;
create trigger whatsapp_group_rules_backfill
  after insert or update of keywords, min_occurrences, window_days, enabled, name
  on public.whatsapp_group_rules
  for each row
  execute function public.whatsapp_group_rules_on_change();

-- Same lockdown as every other product table: the server connection is the
-- only writer, and the Supabase Data API roles get nothing.
alter table public.whatsapp_group_rules enable row level security;
revoke all on table public.whatsapp_group_rules from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.whatsapp_group_rules from anon;
    revoke all on sequence public.whatsapp_group_rules_id_seq from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.whatsapp_group_rules from authenticated;
    revoke all on sequence public.whatsapp_group_rules_id_seq from authenticated;
  end if;
end $$;
revoke execute on function public.whatsapp_group_rule_pattern(text[]) from public;
revoke execute on function public.whatsapp_apply_group_rule(integer, integer) from public;
revoke execute on function public.whatsapp_backfill_group_rule(integer) from public;
