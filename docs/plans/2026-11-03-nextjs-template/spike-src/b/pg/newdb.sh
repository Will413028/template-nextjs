#!/usr/bin/env bash
# Creates database $1 the way 10-roles.sh sets up POSTGRES_DB: owner owns db+public, PUBLIC revoked, app CONNECT only.
set -euo pipefail
docker exec -i spike-b-pg psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<SQL
DROP DATABASE IF EXISTS $1 WITH (FORCE);
CREATE DATABASE $1 OWNER spike_owner;
REVOKE ALL ON DATABASE $1 FROM PUBLIC;
GRANT CONNECT ON DATABASE $1 TO spike_app;
\c $1
ALTER SCHEMA public OWNER TO spike_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SQL
