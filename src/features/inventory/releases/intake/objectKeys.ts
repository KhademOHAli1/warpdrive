export function exportStagingKey(jobId: string, ordinal: number): string {
  return `engineering-export-staging/${jobId}/${ordinal}`;
}

export function exportSealKey(releaseId: string, artifactId: string, attemptId: string): string {
  return `confirmed/inventory-release-artifacts/${releaseId}/${artifactId}/export-${attemptId}`;
}
