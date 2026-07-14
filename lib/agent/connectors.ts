import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "./secrets";
import { validateMcpDestination } from "./mcp-policy";

export type ConnectorRecord = {
  id: string;
  userId: string;
  name: string;
  url: string;
  encryptedAuthorization: string | null;
  enabled: boolean;
  lastCheckedAt: Date | null;
  lastStatus: string | null;
  lastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface ConnectorRepository {
  find(userId: string, id: string): Promise<ConnectorRecord | null>;
  list(userId: string): Promise<ConnectorRecord[]>;
  upsert(
    input: Omit<ConnectorRecord, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ): Promise<ConnectorRecord>;
  remove(userId: string, id: string): Promise<boolean>;
}

export const prismaConnectorRepository: ConnectorRepository = {
  find(userId, id) {
    return prisma.agentMcpConnection.findFirst({ where: { id, userId } });
  },
  list(userId) {
    return prisma.agentMcpConnection.findMany({ where: { userId }, orderBy: { name: "asc" } });
  },
  async upsert(input) {
    const { id, ...data } = input;
    if (!id) return prisma.agentMcpConnection.create({ data });
    const result = await prisma.agentMcpConnection.updateMany({
      where: { id, userId: input.userId },
      data,
    });
    if (result.count !== 1) throw new Error("Connector not found");
    return prisma.agentMcpConnection.findFirstOrThrow({ where: { id, userId: input.userId } });
  },
  async remove(userId, id) {
    const result = await prisma.agentMcpConnection.deleteMany({ where: { id, userId } });
    return result.count > 0;
  },
};

export type ConnectorMetadata = Omit<ConnectorRecord, "userId" | "encryptedAuthorization"> & {
  hasAuthorization: boolean;
};

function metadata(record: ConnectorRecord): ConnectorMetadata {
  return {
    id: record.id,
    name: record.name,
    url: record.url,
    enabled: record.enabled,
    lastCheckedAt: record.lastCheckedAt,
    lastStatus: record.lastStatus,
    lastErrorCode: record.lastErrorCode,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    hasAuthorization: Boolean(record.encryptedAuthorization),
  };
}

export async function saveConnector(
  repository: ConnectorRepository,
  userId: string,
  input: {
    id?: string;
    name: string;
    url: string;
    authorization?: string | null;
    enabled?: boolean;
    validate?: (url: string) => Promise<URL>;
  },
): Promise<ConnectorMetadata> {
  const name = input.name.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!name) throw new Error("Connector name is required");
  const validated = await (input.validate ?? validateMcpDestination)(input.url);
  const existing = input.id ? await repository.find(userId, input.id) : null;
  if (input.id && !existing) throw new Error("Connector not found");
  const authorization = input.authorization?.trim();
  const sameOrigin = existing
    ? new URL(existing.url).origin === validated.origin
    : false;
  const encryptedAuthorization = authorization
    ? encryptSecret(authorization, `mcp:authorization:${userId}`)
    : input.authorization === null
      ? null
      : sameOrigin
        ? existing?.encryptedAuthorization ?? null
        : null;
  return metadata(
    await repository.upsert({
      id: input.id,
      userId,
      name,
      url: validated.toString(),
      encryptedAuthorization,
      enabled: input.enabled ?? existing?.enabled ?? true,
      lastCheckedAt: existing?.lastCheckedAt ?? null,
      lastStatus: existing?.lastStatus ?? null,
      lastErrorCode: existing?.lastErrorCode ?? null,
    }),
  );
}

export async function listConnectorMetadata(repository: ConnectorRepository, userId: string) {
  return (await repository.list(userId)).map(metadata);
}

export async function getConnectorSecret(
  repository: ConnectorRepository,
  userId: string,
  id: string,
): Promise<{
  id: string;
  name: string;
  url: string;
  authorization: string | null;
  updatedAt: Date;
} | null> {
  const record = await repository.find(userId, id);
  if (!record || !record.enabled) return null;
  return {
    id: record.id,
    name: record.name,
    url: record.url,
    updatedAt: record.updatedAt,
    authorization: record.encryptedAuthorization
      ? decryptSecret(record.encryptedAuthorization, `mcp:authorization:${userId}`)
      : null,
  };
}

export function deleteConnector(repository: ConnectorRepository, userId: string, id: string) {
  return repository.remove(userId, id);
}
