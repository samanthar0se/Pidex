export const protocolVersion = "1.0";

export interface HostStatus {
  hostId: string;
  releaseId: string;
  readiness: "ready";
  synchronization: {
    epoch: string;
    sequence: number;
    cursor: string;
  };
}

export type ServerMessage = {
  type: "host.snapshot";
  protocolVersion: typeof protocolVersion;
  status: HostStatus;
};
