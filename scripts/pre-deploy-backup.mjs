#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdir, open, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { Storage } from "@google-cloud/storage";

const DEFAULT_PREFIX = "_nexus-backups/pre-deploy";
const PRISMA_ONLY_QUERY_PARAMETERS = [
  "schema",
  "connection_limit",
  "pool_timeout",
  "socket_timeout",
  "pgbouncer",
];

export function validateBackupId(value) {
  if (!/^[0-9]{14}-[0-9a-f]{7,40}$/.test(value ?? "")) {
    throw new Error(
      "Backup ID must be a UTC YYYYMMDDHHMMSS timestamp and Git SHA",
    );
  }
  return value;
}

export function normalizeDatabaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }

  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL must use the PostgreSQL protocol");
  }

  for (const key of PRISMA_ONLY_QUERY_PARAMETERS) {
    url.searchParams.delete(key);
  }
  return url.toString();
}

export function redactPostgresUrls(value) {
  return value.replace(
    /\bpostgres(?:ql)?:\/\/[^\s'"`]+/gi,
    "[REDACTED_DATABASE_URL]",
  );
}

export function parseTimeoutSeconds(value) {
  if (value === undefined || value === "") return 1200;
  if (!/^\d+$/.test(value)) {
    throw new Error("Backup timeout must be a positive integer in seconds");
  }
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new Error("Backup timeout must be a positive integer in seconds");
  }
  return seconds;
}

export function normalizePrefix(value = DEFAULT_PREFIX) {
  const prefix = value.replace(/^\/+|\/+$/g, "");
  if (!prefix) {
    throw new Error("Backup prefix must not be empty");
  }
  return prefix;
}

export function buildBackupObjectName(prefix, generation, sourceName) {
  if (!/^\d+$/.test(generation ?? "")) {
    throw new Error("Source object generation must be numeric");
  }
  if (!sourceName) {
    throw new Error("Source object name must not be empty");
  }
  const encodedName = Buffer.from(sourceName, "utf8").toString("base64url");
  return `${normalizePrefix(prefix)}/objects/${generation}/${encodedName}`;
}

export function shouldIncludeSourceObject(name, sameBucket, prefix) {
  if (!sameBucket) return true;
  const normalized = normalizePrefix(prefix);
  return name !== normalized && !name.startsWith(`${normalized}/`);
}

export function buildManifest({
  backupId,
  sourceCommit,
  startedAt,
  completedAt,
  sourceBucket,
  backupBucket,
  database,
  documents,
}) {
  const totalBytes = documents.reduce(
    (total, document) => total + document.bytes,
    0,
  );
  return {
    version: 1,
    backupId,
    sourceCommit,
    startedAt,
    completedAt,
    sourceBucket,
    backupBucket,
    database,
    documents: {
      count: documents.length,
      totalBytes,
      objects: documents,
    },
  };
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function runPgDump(databaseUrl, outputPath) {
  const handle = await open(outputPath, "wx", 0o600);
  let stderr = "";
  try {
    const child = spawn(
      "pg_dump",
      [
        databaseUrl,
        "--format=custom",
        "--no-owner",
        "--no-privileges",
      ],
      { stdio: ["ignore", handle.fd, "pipe"] },
    );
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 16_384) stderr += chunk;
    });

    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    if (exitCode !== 0) {
      const detail = redactPostgresUrls(stderr.trim());
      throw new Error(
        `pg_dump failed with exit code ${exitCode}${detail ? `: ${detail}` : ""}`,
      );
    }
  } finally {
    await handle.close();
  }

  const metadata = await stat(outputPath);
  if (!metadata.isFile() || metadata.size === 0) {
    throw new Error("Database backup failed or produced an empty file");
  }
  await chmod(outputPath, 0o600);
  return {
    bytes: metadata.size,
    sha256: await sha256File(outputPath),
  };
}

async function verifyObject(file, expected) {
  const [metadata] = await file.getMetadata();
  const actualSize = Number(metadata.size);
  if (actualSize !== expected.bytes) {
    throw new Error(
      `Backup object ${file.name} has size ${actualSize}, expected ${expected.bytes}`,
    );
  }
  if (expected.crc32c && metadata.crc32c !== expected.crc32c) {
    throw new Error(`Backup object ${file.name} has an unexpected CRC32C`);
  }
  if (expected.md5Hash && metadata.md5Hash !== expected.md5Hash) {
    throw new Error(`Backup object ${file.name} has an unexpected MD5 hash`);
  }
  if (
    expected.sha256 &&
    metadata.metadata?.sha256 !== expected.sha256
  ) {
    throw new Error(`Backup object ${file.name} has an unexpected SHA-256`);
  }
  return metadata;
}

async function uploadDatabase(bucket, localPath, objectName, database) {
  const destination = bucket.file(objectName);
  const [exists] = await destination.exists();
  if (!exists) {
    await bucket.upload(localPath, {
      destination: objectName,
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType: "application/octet-stream",
        metadata: { sha256: database.sha256 },
      },
    });
  }
  await verifyObject(destination, database);
}

async function snapshotDocuments({
  sourceBucket,
  backupBucket,
  sameBucket,
  prefix,
}) {
  const [sourceFiles] = await sourceBucket.getFiles();
  const documents = [];

  for (const sourceFile of sourceFiles) {
    if (!shouldIncludeSourceObject(sourceFile.name, sameBucket, prefix)) {
      continue;
    }

    const [sourceMetadata] = await sourceFile.getMetadata();
    const generation = String(sourceMetadata.generation ?? "");
    const bytes = Number(sourceMetadata.size);
    if (!generation || !Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error(`Source object ${sourceFile.name} has invalid metadata`);
    }

    const backupObject = buildBackupObjectName(
      prefix,
      generation,
      sourceFile.name,
    );
    const destination = backupBucket.file(backupObject);
    const expected = {
      bytes,
      crc32c: sourceMetadata.crc32c,
      md5Hash: sourceMetadata.md5Hash,
    };
    const [exists] = await destination.exists();
    if (!exists) {
      const sourceGeneration = sourceBucket.file(sourceFile.name, { generation });
      await sourceGeneration.copy(destination, {
        preconditionOpts: { ifGenerationMatch: 0 },
      });
    }
    await verifyObject(destination, expected);

    documents.push({
      name: sourceFile.name,
      generation,
      bytes,
      crc32c: sourceMetadata.crc32c ?? null,
      md5Hash: sourceMetadata.md5Hash ?? null,
      backupObject,
    });
  }

  return documents.sort((left, right) =>
    left.name.localeCompare(right.name) ||
    left.generation.localeCompare(right.generation),
  );
}

async function publishManifest(bucket, objectName, manifest) {
  const payload = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const file = bucket.file(objectName);
  const [exists] = await file.exists();
  if (exists) {
    throw new Error(`Completion manifest already exists: ${objectName}`);
  }
  await file.save(payload, {
    resumable: false,
    preconditionOpts: { ifGenerationMatch: 0 },
    contentType: "application/json",
  });
  await verifyObject(file, { bytes: payload.length });
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/pre-deploy-backup.mjs\n\nRequired environment:\n  BACKUP_ID       UTC timestamp plus Git SHA\n  SOURCE_COMMIT   Git commit being deployed\n  DATABASE_URL    Production PostgreSQL URL\n  GCS_BUCKET      Source document bucket\n\nOptional environment:\n  BACKUP_GCS_BUCKET      Dedicated destination bucket\n  BACKUP_GCS_PREFIX      Destination prefix\n  BACKUP_LOCAL_DIR       Local dump directory (default: /backups)\n  BACKUP_TIMEOUT_SECONDS Hard deadline (default: 1200)\n`);
}

async function runBackup() {
  const startedAt = new Date().toISOString();
  const backupId = validateBackupId(process.env.BACKUP_ID);
  const sourceCommit = process.env.SOURCE_COMMIT ?? "";
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw new Error("SOURCE_COMMIT must be a full Git SHA");
  }
  if (!backupId.endsWith(`-${sourceCommit}`)) {
    throw new Error("BACKUP_ID must end with SOURCE_COMMIT");
  }

  const sourceBucketName = process.env.GCS_BUCKET;
  if (!sourceBucketName) {
    throw new Error("GCS_BUCKET is required for document backup");
  }
  const backupBucketName = process.env.BACKUP_GCS_BUCKET || sourceBucketName;
  const prefix = normalizePrefix(
    process.env.BACKUP_GCS_PREFIX || DEFAULT_PREFIX,
  );
  const localDirectory = process.env.BACKUP_LOCAL_DIR || "/backups";
  const databaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL);

  await mkdir(localDirectory, { recursive: true, mode: 0o700 });
  await chmod(localDirectory, 0o700);
  const localFileName = `nexus-before-${backupId}.dump`;
  const localPath = path.join(localDirectory, localFileName);

  console.error(`[backup] creating PostgreSQL dump for ${backupId}`);
  const database = await runPgDump(databaseUrl, localPath);

  const storage = new Storage();
  const sourceBucket = storage.bucket(sourceBucketName);
  const backupBucket = storage.bucket(backupBucketName);
  const snapshotPrefix = `${prefix}/snapshots/${backupId}`;
  const databaseObject = `${snapshotPrefix}/database.dump`;

  console.error(`[backup] uploading and verifying ${localFileName}`);
  await uploadDatabase(backupBucket, localPath, databaseObject, database);

  console.error("[backup] snapshotting document object generations");
  const documents = await snapshotDocuments({
    sourceBucket,
    backupBucket,
    sameBucket: sourceBucketName === backupBucketName,
    prefix,
  });

  const completedAt = new Date().toISOString();
  const manifest = buildManifest({
    backupId,
    sourceCommit,
    startedAt,
    completedAt,
    sourceBucket: sourceBucketName,
    backupBucket: backupBucketName,
    database: {
      object: databaseObject,
      localFile: localFileName,
      bytes: database.bytes,
      sha256: database.sha256,
    },
    documents,
  });
  const manifestObject = `${snapshotPrefix}/manifest.json`;

  console.error("[backup] publishing verified completion manifest");
  await publishManifest(backupBucket, manifestObject, manifest);

  process.stdout.write(
    `${JSON.stringify({
      backupId,
      databaseBytes: database.bytes,
      databaseSha256: database.sha256,
      documentCount: documents.length,
      manifestObject,
      verified: true,
    })}\n`,
  );
}

async function main() {
  if (process.argv.includes("--help")) {
    printHelp();
    return;
  }

  const timeoutSeconds = parseTimeoutSeconds(process.env.BACKUP_TIMEOUT_SECONDS);
  const timeout = setTimeout(() => {
    console.error(
      `[backup] failed: exceeded hard timeout of ${timeoutSeconds} seconds`,
    );
    process.exit(124);
  }, timeoutSeconds * 1000);

  try {
    await runBackup();
  } finally {
    clearTimeout(timeout);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(`[backup] failed: ${error.message}`);
    process.exitCode = 1;
  });
}
