import {
  identifierSchema,
  type LocalControlRole,
} from "./contract-schemas.js";

export interface LocalPeerEvidence {
  readonly local: boolean;
  readonly sid: string;
  readonly elevated: boolean;
  readonly appContainer: boolean;
  readonly instanceId: string;
  readonly role: LocalControlRole;
}

/** Fail-closed authorization boundary called after native pipe impersonation. */
export class LocalControlAdmission {
  readonly #instanceId: string;
  readonly #owningSid: string;
  readonly #allowedRoles: ReadonlySet<LocalControlRole>;

  constructor(options: {
    instanceId: string;
    owningSid: string;
    allowedRoles: readonly LocalControlRole[];
  }) {
    this.#instanceId = identifierSchema.parse(options.instanceId);
    this.#owningSid = options.owningSid;
    this.#allowedRoles = new Set(options.allowedRoles);
  }

  route<T>(peer: LocalPeerEvidence, route: () => T): T {
    if (
      !peer.local ||
      peer.sid !== this.#owningSid ||
      !peer.elevated ||
      peer.appContainer ||
      peer.instanceId !== this.#instanceId ||
      !this.#allowedRoles.has(peer.role)
    ) {
      throw new Error("local-control peer rejected");
    }
    return route();
  }
}
