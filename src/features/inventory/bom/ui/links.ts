export function bomHref(scope: { releaseId?: string; partId?: string; siteId?: string }) {
  const params = new URLSearchParams();
  if (scope.releaseId !== undefined) params.set("releaseId", scope.releaseId);
  if (scope.partId !== undefined) params.set("partId", scope.partId);
  if (scope.siteId !== undefined) params.set("siteId", scope.siteId);
  return params.size === 0 ? "/inventory/bom" : `/inventory/bom?${params}`;
}
