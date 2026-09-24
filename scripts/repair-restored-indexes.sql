-- Manual fallback for the 2026-09-23 damage: make again, on a module's live
-- schema, every index its live version's migrations declare. The platform
-- now does this itself at every boot, deploy, switch and data restore
-- (migrate.ensureIndexes); this is the same thing by hand, for one module,
-- when the instance cannot be redeployed. Idempotent (IF NOT EXISTS).
--   psql "$DATABASE_URL" -v co=demo -v mod=roving-watch-logs -f scripts/repair-restored-indexes.sql
SET sos.co TO :'co';
SET sos.mod TO :'mod';
DO $$ DECLARE s text; live text; BEGIN
  live := 'mod_' || regexp_replace(current_setting('sos.co'), '[^a-zA-Z0-9_]', '_', 'g') || '_' || regexp_replace(current_setting('sos.mod'), '[^a-zA-Z0-9_]', '_', 'g');
  PERFORM set_config('search_path', live || ', public', true);
  FOR s IN SELECT m[1] FROM platform.modules p
    JOIN platform.module_versions v ON v.company = p.company AND v.module = p.name AND v.version = p.live_version,
    jsonb_each_text(v.files) f, regexp_matches(f.value, '(CREATE\s+(?:UNIQUE\s+)?INDEX[^;]+)', 'gi') m
    WHERE p.company = current_setting('sos.co') AND p.name = current_setting('sos.mod') AND f.key LIKE 'migrations/%'
  LOOP
    EXECUTE regexp_replace(s, '^(CREATE\s+(?:UNIQUE\s+)?INDEX\s+)(?!IF\s+NOT\s+EXISTS)', '\1IF NOT EXISTS ', 'i');
  END LOOP;
END $$;
