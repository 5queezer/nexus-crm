import { describe, expect, it } from "vitest";

import {
  buildBackupObjectName,
  buildManifest,
  normalizeDatabaseUrl,
  normalizePrefix,
  parseTimeoutSeconds,
  redactPostgresUrls,
  shouldIncludeSourceObject,
  validateBackupId,
} from "../pre-deploy-backup.mjs";

describe("validateBackupId", () => {
  it("accepts a timestamp and full Git SHA", () => {
    expect(
      validateBackupId(
        "20260714055021-b4776266f9f0997268584c9f8f4493acc227e7ea",
      ),
    ).toBe(
      "20260714055021-b4776266f9f0997268584c9f8f4493acc227e7ea",
    );
  });

  it.each([
    "",
    "latest",
    "20260714055021-main",
    "../../production",
    "20260714055021-b477626/extra",
  ])("rejects unsafe or non-addressable ID %j", (value) => {
    expect(() => validateBackupId(value)).toThrow(/backup id/i);
  });
});

describe("normalizeDatabaseUrl", () => {
  it("removes Prisma-only query parameters and preserves libpq options", () => {
    const result = normalizeDatabaseUrl(
      "postgresql://user:secret@db:5432/nexus?schema=public&connection_limit=5&pool_timeout=10&socket_timeout=20&pgbouncer=true&sslmode=require&application_name=nexus",
    );

    expect(result).toBe(
      "postgresql://user:secret@db:5432/nexus?sslmode=require&application_name=nexus",
    );
  });

  it("rejects non-PostgreSQL URLs", () => {
    expect(() => normalizeDatabaseUrl("https://example.com/database")).toThrow(
      /postgres/i,
    );
  });
});

describe("redactPostgresUrls", () => {
  it("removes PostgreSQL credentials from command errors", () => {
    expect(
      redactPostgresUrls(
        "pg_dump failed for postgresql://user:password@db:5432/nexus?sslmode=require",
      ),
    ).toBe("pg_dump failed for [REDACTED_DATABASE_URL]");
  });
});

describe("parseTimeoutSeconds", () => {
  it("uses a bounded default", () => {
    expect(parseTimeoutSeconds(undefined)).toBe(1200);
  });

  it("accepts an explicit positive timeout", () => {
    expect(parseTimeoutSeconds("900")).toBe(900);
  });

  it.each(["0", "-1", "1.5", "not-a-number"])(
    "rejects invalid timeout %j",
    (value) => {
      expect(() => parseTimeoutSeconds(value)).toThrow(/timeout/i);
    },
  );
});

describe("backup object naming", () => {
  it("normalizes a configured prefix", () => {
    expect(normalizePrefix("/_nexus-backups/pre-deploy///")).toBe(
      "_nexus-backups/pre-deploy",
    );
  });

  it("rejects an empty prefix", () => {
    expect(() => normalizePrefix("///")).toThrow(/prefix/i);
  });

  it("uses source generation and an encoded source name", () => {
    expect(
      buildBackupObjectName(
        "_nexus-backups/pre-deploy",
        "1741000000000000",
        "folder/document 1.pdf",
      ),
    ).toBe(
      "_nexus-backups/pre-deploy/objects/1741000000000000/Zm9sZGVyL2RvY3VtZW50IDEucGRm",
    );
  });

  it("excludes the reserved namespace only for a same-bucket backup", () => {
    const prefix = "_nexus-backups/pre-deploy";
    expect(
      shouldIncludeSourceObject(
        "_nexus-backups/pre-deploy/snapshots/old/manifest.json",
        true,
        prefix,
      ),
    ).toBe(false);
    expect(
      shouldIncludeSourceObject(
        "_nexus-backups/pre-deployable/document.pdf",
        true,
        prefix,
      ),
    ).toBe(true);
    expect(
      shouldIncludeSourceObject(
        "_nexus-backups/pre-deploy/snapshots/old/manifest.json",
        false,
        prefix,
      ),
    ).toBe(true);
  });
});

describe("buildManifest", () => {
  it("creates a commit-addressable manifest without secrets", () => {
    const manifest = buildManifest({
      backupId: "20260714055021-b4776266f9f0997268584c9f8f4493acc227e7ea",
      sourceCommit: "b4776266f9f0997268584c9f8f4493acc227e7ea",
      startedAt: "2026-07-14T05:50:21.000Z",
      completedAt: "2026-07-14T05:51:21.000Z",
      sourceBucket: "source-documents",
      backupBucket: "backup-data",
      database: {
        object: "prefix/snapshots/id/database.dump",
        localFile: "nexus-before-id.dump",
        bytes: 1234,
        sha256: "a".repeat(64),
      },
      documents: [
        {
          name: "document.pdf",
          generation: "1741000000000000",
          bytes: 42,
          crc32c: "AAAAAA==",
          md5Hash: "BBBBBB==",
          backupObject: "prefix/objects/1741000000000000/ZG9jdW1lbnQucGRm",
        },
      ],
    });

    expect(manifest.version).toBe(1);
    expect(manifest.sourceCommit).toBe(
      "b4776266f9f0997268584c9f8f4493acc227e7ea",
    );
    expect(manifest.database.sha256).toHaveLength(64);
    expect(manifest.documents.count).toBe(1);
    expect(manifest.documents.totalBytes).toBe(42);
    expect(JSON.stringify(manifest)).not.toContain("secret");
  });
});
