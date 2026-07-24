-- Local-only credentials. Production roles and secrets must be provisioned by
-- the deployment platform, using the same privilege split.
CREATE ROLE cluchess_migrator
    LOGIN
    PASSWORD 'cluchess_migrator_dev'
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE;

CREATE ROLE cluchess_runtime
    LOGIN
    PASSWORD 'cluchess_runtime_dev'
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE;

GRANT CONNECT ON DATABASE cluchess TO cluchess_migrator, cluchess_runtime;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO cluchess_migrator;
GRANT USAGE ON SCHEMA public TO cluchess_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE cluchess_migrator IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cluchess_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE cluchess_migrator IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO cluchess_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE cluchess_migrator IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO cluchess_runtime;
