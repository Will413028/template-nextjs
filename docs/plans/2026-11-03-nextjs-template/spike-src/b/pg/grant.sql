-- Same statements as template-go-nextjs backend/internal/platform/migrate/migrate.go grant(), run as the owner after migrating.
BEGIN;
GRANT USAGE ON SCHEMA public TO spike_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO spike_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO spike_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO spike_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO spike_app;
COMMIT;
