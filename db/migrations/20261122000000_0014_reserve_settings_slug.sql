-- /settings is now an app page, so no project may use it as its URL slug. Mirrors RESERVED_SLUGS in lib/routes.ts.
do $$
declare
  n int := 2;
begin
  if exists (select 1 from public.projects where slug = 'settings') then
    while exists (select 1 from public.projects where slug = 'settings-' || n) loop
      n := n + 1;
    end loop;
    update public.projects set slug = 'settings-' || n where slug = 'settings';
  end if;
end $$;
