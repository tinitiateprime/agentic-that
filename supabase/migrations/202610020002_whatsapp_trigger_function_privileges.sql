-- Internal trigger callbacks are not browser RPCs. Keep the existing triggers
-- and business data while removing default public execution grants.
do $$
declare
  callback_name text;
  callback_oid regprocedure;
begin
  foreach callback_name in array array['whatsapp_group_rules_on_change', 'whatsapp_group_rules_on_message'] loop
    callback_oid := to_regprocedure(format('public.%I()', callback_name));
    if callback_oid is not null then
      if (select prorettype from pg_proc where oid = callback_oid) <> 'trigger'::regtype then
        raise exception 'Expected an internal trigger callback: %', callback_name;
      end if;
      execute format('revoke execute on function public.%I() from public, anon, authenticated', callback_name);
    end if;
  end loop;
end
$$;
