-- Projects get a URL slug: pages live at /{project}/{workspace}. Unique, never reused for a reserved
-- top-level route, and stable across renames. Mirrors projectUrlSlug/RESERVED_SLUGS in lib/routes.ts.
alter table public.projects add column slug text;

do $$
declare
  reserved constant text[] := array['projects', 'inbox', 'notes', 'routines', 'vault', 'mock', 'api', 'p', 'w', 's', 'new', '_next'];
  r record;
  base text;
  candidate text;
  n int;
begin
  for r in select id, name from public.projects order by created_at, id loop
    base := trim(trailing '-' from left(trim(both '-' from regexp_replace(lower(r.name), '[^a-z0-9]+', '-', 'g')), 48));
    if base = '' then base := 'project'; end if;
    n := 1;
    loop
      candidate := case when n = 1 then base else base || '-' || n end;
      exit when not (candidate = any(reserved)) and not exists (select 1 from public.projects where slug = candidate);
      n := n + 1;
    end loop;
    update public.projects set slug = candidate where id = r.id;
  end loop;
end $$;

alter table public.projects alter column slug set not null;
alter table public.projects add constraint projects_slug_key unique (slug);
