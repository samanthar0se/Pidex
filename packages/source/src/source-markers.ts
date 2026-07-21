export const SOURCE_CHECKOUT_MARKER_FILE = ".pidex-source-instance.json";
export const SOURCE_PREPARATION_MARKER_FILE = "prepared.json";

export interface SourceInstanceMarker {
  schemaVersion: 1;
  instanceId: string;
}

export function isValidSourceInstanceMarker(marker: SourceInstanceMarker): boolean {
  return marker.schemaVersion === 1 && /^[0-9a-f-]{36}$/i.test(marker.instanceId);
}

export function matchesSourceInstanceMarker(
  marker: SourceInstanceMarker,
  instanceId: string,
): boolean {
  return isValidSourceInstanceMarker(marker) && marker.instanceId === instanceId;
}
