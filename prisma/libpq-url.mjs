const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const url = new URL(databaseUrl);
for (const parameter of [
  "schema",
  "connection_limit",
  "pool_timeout",
  "socket_timeout",
  "pgbouncer",
]) {
  url.searchParams.delete(parameter);
}

process.stdout.write(url.toString());
