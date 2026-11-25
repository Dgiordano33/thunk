-- In-place workspaces were all named "main" and shown as "Local". Give each a moon name like any other
-- workspace, one its project doesn't use yet. The slug stays "main", so paths, memory and URLs are unchanged.
update workspaces w set name = coalesce((
  select m from unnest(array['luna', 'phobos', 'deimos', 'io', 'europa', 'ganymede', 'callisto', 'amalthea', 'himalia', 'elara', 'pasiphae', 'sinope', 'lysithea', 'carme', 'ananke', 'leda', 'thebe', 'adrastea', 'metis', 'mimas', 'enceladus', 'tethys', 'dione', 'rhea', 'titan', 'hyperion', 'iapetus', 'phoebe', 'janus', 'epimetheus', 'helene', 'telesto', 'calypso', 'atlas', 'prometheus', 'pandora', 'pan', 'ariel', 'umbriel', 'titania', 'oberon', 'miranda', 'puck', 'portia', 'triton', 'nereid', 'proteus', 'charon', 'nix', 'hydra']) as t(m)
  where not exists (select 1 from workspaces o where o.project_id = w.project_id and (o.slug = m or o.name = m))
  order by random() limit 1
), 'main')
where w.slug = 'main' and w.name = 'main';
