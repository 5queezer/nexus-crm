const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const CLOUD_DEPLOYMENT_ENVIRONMENT_KEYS = [
  "VERCEL",
  "VERCEL_ENV",
  "NETLIFY",
  "RENDER",
  "RENDER_SERVICE_ID",
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_ENVIRONMENT_ID",
  "RAILWAY_ENVIRONMENT_NAME",
  "RAILWAY_PROJECT_ID",
  "FLY_APP_NAME",
  "K_SERVICE",
  "CF_PAGES",
  "AWS_LAMBDA_FUNCTION_NAME",
  "CI",
] as const;

function parseURL(value: string | undefined, variableName: string): URL {
  if (!value) {
    throw new Error(`${variableName} is required when local development authentication is enabled.`);
  }

  try {
    return new URL(value);
  } catch {
    throw new Error(`${variableName} must be a valid URL.`);
  }
}

function assertLoopbackHost(url: URL, variableName: string) {
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(`${variableName} must use a loopback host.`);
  }
}

export function assertLocalDevelopmentEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.LOCAL_DEV_AUTH !== "1") {
    throw new Error("LOCAL_DEV_AUTH must be exactly 1.");
  }
  if (env.NODE_ENV !== "development") {
    throw new Error("Local development authentication requires NODE_ENV=development.");
  }
  if (env.DB_PROVIDER && env.DB_PROVIDER !== "prisma") {
    throw new Error("Local development authentication requires the Prisma database provider.");
  }

  const cloudEnvironment = CLOUD_DEPLOYMENT_ENVIRONMENT_KEYS.find((key) => Boolean(env[key]));
  if (cloudEnvironment) {
    throw new Error(`Local development authentication cannot run in a cloud deployment (${cloudEnvironment}).`);
  }

  const databaseURL = parseURL(env.DATABASE_URL, "DATABASE_URL");
  if (databaseURL.protocol !== "postgresql:" && databaseURL.protocol !== "postgres:") {
    throw new Error("DATABASE_URL must use the PostgreSQL protocol.");
  }
  assertLoopbackHost(databaseURL, "DATABASE_URL");
  if (databaseURL.pathname !== "/nexus_local_dev") {
    throw new Error("DATABASE_URL must target the nexus_local_dev database.");
  }
  if (databaseURL.search || databaseURL.hash) {
    throw new Error("DATABASE_URL cannot contain query parameters or a fragment.");
  }

  const authURL = parseURL(env.BETTER_AUTH_URL, "BETTER_AUTH_URL");
  if (authURL.protocol !== "http:" && authURL.protocol !== "https:") {
    throw new Error("BETTER_AUTH_URL must use HTTP or HTTPS.");
  }
  assertLoopbackHost(authURL, "BETTER_AUTH_URL");
  if (
    authURL.pathname !== "/" ||
    authURL.search ||
    authURL.hash ||
    authURL.username ||
    authURL.password
  ) {
    throw new Error("BETTER_AUTH_URL must be a loopback origin without credentials, path, query, or fragment.");
  }
}

export function isLocalDevelopmentAuthEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.LOCAL_DEV_AUTH !== "1" || env.NODE_ENV !== "development") {
    return false;
  }

  assertLocalDevelopmentEnvironment(env);
  return true;
}
