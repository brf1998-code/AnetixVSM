-- Repair after a revert with data dropped indexes (the 2026-09-23 failure):
-- for the module named below, find the snapshot its last restore came from
-- and make again, on the live tables, every index that snapshot has and the
-- live table lacks (matched by definition, not name). Safe to run twice.
--   psql "$DATABASE_URL" -v ref='demo/<module>' -f scripts/repair-restored-indexes.sql
-- (ref is "<company>/<module>", as in platform.events.ref)
SET sos.ref TO :'ref';
DO $$
DECLARE
  v_ref    text := current_setting('sos.ref');
  snap     text;
  live     text;
  r        record;
  shape_l  text[];
  made     int := 0;
BEGIN
  SELECT detail->>'snapshot' INTO snap FROM platform.events
   WHERE kind = 'schema_restored' AND platform.events.ref = v_ref ORDER BY id DESC LIMIT 1;
  IF snap IS NULL THEN RAISE EXCEPTION 'no schema_restored event for %', v_ref; END IF;
  live := 'mod_' || regexp_replace(split_part(v_ref, '/', 1), '[^a-zA-Z0-9_]', '_', 'g')
       || '_'    || regexp_replace(split_part(v_ref, '/', 2), '[^a-zA-Z0-9_]', '_', 'g');
  RAISE NOTICE 'live schema % from snapshot %', live, snap;
  FOR r IN SELECT tablename, indexdef FROM pg_indexes WHERE schemaname = snap LOOP
    SELECT array_agg(regexp_replace(indexdef, '^CREATE (UNIQUE )?INDEX \S+ ON \S+\.(\S+) ', 'CREATE \1INDEX ON \2 '))
      INTO shape_l FROM pg_indexes WHERE schemaname = live AND tablename = r.tablename;
    IF regexp_replace(r.indexdef, '^CREATE (UNIQUE )?INDEX \S+ ON \S+\.(\S+) ', 'CREATE \1INDEX ON \2 ') = ANY (COALESCE(shape_l, '{}')) THEN
      CONTINUE;
    END IF;
    EXECUTE regexp_replace(r.indexdef, '^CREATE (UNIQUE )?INDEX \S+ ON \S+\.', 'CREATE \1INDEX ON ' || live || '.');
    made := made + 1;
    RAISE NOTICE 'made: %', regexp_replace(r.indexdef, '^CREATE (UNIQUE )?INDEX \S+ ON \S+\.', 'CREATE \1INDEX ON ' || live || '.');
  END LOOP;
  RAISE NOTICE '% index(es) made', made;
END $$;
