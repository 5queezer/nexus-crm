export interface DocumentAssociationRef {
  id: string;
}

export interface DocumentAssociationRecord {
  applicationIds?: string[];
  applications?: DocumentAssociationRef[];
}

/**
 * Fail-closed document boundary for machine and public paths.
 * Raw association IDs are internal provenance and are never returned.
 */
export async function sanitizeDocumentAssociations<T extends DocumentAssociationRecord>(
  document: T,
  resolveVisibleParent: (id: string) => Promise<unknown | null>,
): Promise<T | null> {
  const rawIds = Array.isArray(document.applicationIds) ? document.applicationIds : [];
  const hydrated = Array.isArray(document.applications) ? document.applications : [];
  const withoutRawIds = { ...document };
  delete withoutRawIds.applicationIds;

  if (!hydrated.length) {
    return rawIds.length ? null : withoutRawIds as T;
  }

  const visible = await Promise.all(
    hydrated.map(async (application) =>
      await resolveVisibleParent(application.id) ? application : null),
  );
  const applications = visible.filter(
    (application): application is DocumentAssociationRef => application !== null,
  );
  if (!applications.length) return null;

  return { ...withoutRawIds, applications } as T;
}
