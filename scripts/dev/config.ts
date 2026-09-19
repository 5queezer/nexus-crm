import { createHash, randomBytes } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import { assertLocalDevelopmentEnvironment } from "../../lib/auth/local-development";

export interface LocalConfig { env: NodeJS.ProcessEnv; port: number; file: string; created: boolean }

const guardedKeys = ["DATABASE_URL", "BETTER_AUTH_URL", "BETTER_AUTH_SECRET", "AGENT_SECRET_ENCRYPTION_KEY", "DB_PROVIDER", "LOCAL_DEV_AUTH", "LOCAL_DEV_PROJECT", "LOCAL_DEV_DB_PASSWORD", "LOCAL_DEV_DB_PORT", "LOCAL_DEV_PORT", "LOCAL_DEV_ADMIN_EMAIL", "LOCAL_DEV_USER_EMAIL", "LOCAL_DEV_ADMIN_PASSWORD", "LOCAL_DEV_USER_PASSWORD", "ALLOWED_EMAIL"];
const shellKeys = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TERM", "COLORTERM", "NO_COLOR", "FORCE_COLOR", "SYSTEMROOT", "COMSPEC", "PATHEXT", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "XDG_RUNTIME_DIR", "NODE_EXTRA_CA_CERTS"];
const integrationKeys = ["GCS_BUCKET", "GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "RR_API_URL", "RR_API_KEY", "RR_BASE_RESUME_ID", "EMAIL_SCAN_SECRET", "EMAIL_TOKEN_ENCRYPTION_KEY", "MCP_OAUTH_SECRET", "OAUTH_TRUSTED_IP_HEADER", "PUBLIC_READ_TOKEN", "APP_TITLE"];

function assertLocalShell(env: Partial<NodeJS.ProcessEnv>) {
  if ((env.NODE_ENV && env.NODE_ENV !== "development") || env.VERCEL || env.VERCEL_ENV || env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_PROJECT_ID || env.FLY_APP_NAME || env.K_SERVICE || env.RENDER || env.CI) {
    throw new Error("Local development commands cannot run in production, CI, or a hosted environment");
  }
}

function port(value: string | undefined, fallback: number) {
  const raw = value ?? String(fallback);
  if (!/^\d+$/.test(raw) || Number(raw) < 1024 || Number(raw) > 65535) throw new Error("Local port must be an integer from 1024 to 65535");
  return Number(raw);
}

function makeEnvironment(root: string, input: Partial<NodeJS.ProcessEnv>): Record<string, string> {
  const appPort = port(input.LOCAL_DEV_PORT, 3001);
  const dbPort = port(input.LOCAL_DEV_DB_PORT, 55441);
  const dbPassword = randomBytes(24).toString("hex");
  return {
    LOCAL_DEV_AUTH: "1", DB_PROVIDER: "prisma",
    LOCAL_DEV_PROJECT: `nexus-local-dev-${createHash("sha256").update(root).digest("hex").slice(0, 8)}`,
    LOCAL_DEV_PORT: String(appPort), LOCAL_DEV_DB_PORT: String(dbPort), LOCAL_DEV_DB_PASSWORD: dbPassword,
    DATABASE_URL: `postgresql://nexus_local_dev:${dbPassword}@127.0.0.1:${dbPort}/nexus_local_dev`,
    BETTER_AUTH_URL: `http://localhost:${appPort}`, BETTER_AUTH_SECRET: randomBytes(32).toString("base64url"),
    AGENT_SECRET_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    LOCAL_DEV_ADMIN_EMAIL: "dev-admin@nexus.local", LOCAL_DEV_USER_EMAIL: "dev-user@nexus.local",
    LOCAL_DEV_ADMIN_PASSWORD: randomBytes(24).toString("base64url"), LOCAL_DEV_USER_PASSWORD: randomBytes(24).toString("base64url"),
    ALLOWED_EMAIL: "dev-admin@nexus.local,dev-user@nexus.local", UPLOAD_DIR: ".dev-local/uploads",
  };
}

function validate(root: string, values: Record<string, string>, inherited: Partial<NodeJS.ProcessEnv>): LocalConfig {
  assertLocalShell(inherited);
  const emailKeys = ["LOCAL_DEV_ADMIN_EMAIL", "LOCAL_DEV_USER_EMAIL"];
  for (const key of emailKeys) if (values[key]) values[key] = values[key].trim().toLowerCase();
  for (const key of guardedKeys) {
    if (!values[key]) throw new Error(`.env.local is not a complete local profile: missing ${key}. Run npm run dev:setup in a fresh checkout or supply the local profile explicitly.`);
    const inheritedValue = emailKeys.includes(key) ? inherited[key]?.trim().toLowerCase() : inherited[key];
    if (inheritedValue !== undefined && inheritedValue !== values[key]) throw new Error(`Inherited ${key} conflicts with .env.local; unset it before using the local profile`);
  }
  if (values.NODE_ENV && values.NODE_ENV !== "development") throw new Error("The local profile cannot select a production runtime");
  assertLocalDevelopmentEnvironment({ ...inherited, ...values, NODE_ENV: "development" });
  // Keep OS process essentials; app credentials, remote Docker settings and NODE_OPTIONS
  // are accepted only when explicitly placed in this developer-owned local profile.
  const shell = Object.fromEntries(shellKeys.filter(key => inherited[key] !== undefined).map(key => [key, inherited[key]]));
  const env: NodeJS.ProcessEnv = { ...shell, ...values, NODE_ENV: "development", PRISMA_LOG_QUERIES: values.PRISMA_LOG_QUERIES ?? "0" };
  // Defined empty values also prevent Next from importing these from another .env file.
  for (const key of integrationKeys) env[key] = values[key] ?? "";
  env.NEXT_PUBLIC_BETTER_AUTH_URL = values.BETTER_AUTH_URL;
  env.APP_BASE_URL = values.BETTER_AUTH_URL;
  const appPort = port(values.LOCAL_DEV_PORT, 3001);
  const database = new URL(values.DATABASE_URL);
  if (database.username !== "nexus_local_dev" || database.port !== String(port(values.LOCAL_DEV_DB_PORT, 55441)) || decodeURIComponent(database.password) !== values.LOCAL_DEV_DB_PASSWORD) throw new Error("Local database credentials must match the Compose profile");
  if (new URL(values.BETTER_AUTH_URL).port !== String(appPort)) throw new Error("BETTER_AUTH_URL port must match LOCAL_DEV_PORT");
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(values.LOCAL_DEV_PROJECT)) throw new Error("Invalid local Compose project name");
  if (values.BETTER_AUTH_SECRET.length < 32 || !/^[a-f\d]{64}$/i.test(values.AGENT_SECRET_ENCRYPTION_KEY)) throw new Error("The local profile requires strong auth and encryption secrets");
  if (values.LOCAL_DEV_ADMIN_EMAIL === values.LOCAL_DEV_USER_EMAIL) throw new Error("Local admin and regular users need different email addresses");
  const allowed = values.ALLOWED_EMAIL.split(",").map(value => value.trim().toLowerCase());
  for (const role of ["ADMIN", "USER"]) {
    const email = values[`LOCAL_DEV_${role}_EMAIL`];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !allowed.includes(email.toLowerCase())) throw new Error("Local seed accounts must be valid and included in ALLOWED_EMAIL");
    const password = values[`LOCAL_DEV_${role}_PASSWORD`];
    if (password.length < 12 || password.length > 128) throw new Error("Local account passwords must contain 12–128 characters");
  }
  return { env, port: appPort, file: path.join(root, ".env.local"), created: false };
}

export async function loadLocalConfig(root: string, inherited: Partial<NodeJS.ProcessEnv> = process.env): Promise<LocalConfig> {
  assertLocalShell(inherited);
  let content: string;
  try {
    const file = path.join(root, ".env.local");
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(".env.local must be a regular file, not a symlink");
    if (process.platform !== "win32" && (info.mode & 0o077) !== 0) throw new Error(".env.local contains credentials; restrict it with chmod 600 .env.local");
    content = await readFile(file, "utf8");
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Local profile is missing. Run npm run dev:setup first.");
    throw error;
  }
  return validate(root, parseEnv(content) as Record<string, string>, inherited);
}

export async function ensureLocalConfig(root: string, inherited: Partial<NodeJS.ProcessEnv> = process.env): Promise<LocalConfig> {
  assertLocalShell(inherited);
  try { return await loadLocalConfig(root, inherited); }
  catch (error) {
    if (!(error instanceof Error) || error.message !== "Local profile is missing. Run npm run dev:setup first.") throw error;
  }
  const values = makeEnvironment(root, inherited);
  const config = validate(root, values, inherited);
  const content = "# Private local development profile. Generated once; never commit this file.\n" + Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n";
  try { await writeFile(config.file, content, { encoding: "utf8", mode: 0o600, flag: "wx" }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return loadLocalConfig(root, inherited);
    throw error;
  }
  return { ...config, created: true };
}
