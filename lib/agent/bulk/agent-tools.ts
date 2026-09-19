import { prismaBulkCommandRepository } from "./prisma-repository";
import { createBulkPreview, reviseBulkPreview } from "./service";
import { toBulkCommandSnapshot } from "./snapshot";
import { bulkPreviewRequestSchema, bulkRevisionRequestSchema } from "./validation";

export async function createBulkPreviewForAgent(userId: string, input: unknown) {
  const parsed = bulkPreviewRequestSchema.parse(input);
  const command = await createBulkPreview({
    repository: prismaBulkCommandRepository,
    userId,
    ...parsed,
  });
  return toBulkCommandSnapshot(command);
}

export async function reviseBulkPreviewForAgent(
  userId: string,
  commandId: string,
  input: unknown,
) {
  const parsed = bulkRevisionRequestSchema.parse(input);
  const command = await reviseBulkPreview({
    repository: prismaBulkCommandRepository,
    userId,
    commandId,
    ...parsed,
  });
  return toBulkCommandSnapshot(command);
}
