export function realApplications<T extends { isDemo?: boolean }>(applications: readonly T[]): T[] {
  return applications.filter((application) => application.isDemo !== true);
}
