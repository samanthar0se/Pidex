import { readFileSync } from "node:fs";

export interface PublisherManifest {
  schemaVersion: number;
  publishers: Publisher[];
  classifications: Classification[];
}

export interface Publisher {
  id: string;
  owner: string;
  protocol: string;
  validator: string;
  boundary: string;
  recovery: string;
  acknowledgment: string;
  steps: string[];
}

export interface Classification {
  id: string;
  classification: string;
  reason: string;
}

export const authoritativePublisherIds = [
  "run-completion-evidence",
  "content-addressed-objects",
  "authority-generations",
  "online-snapshot",
  "portable-backup-bundle",
  "portable-backup-catalog",
  "runnable-release",
  "release-selector",
  "installation-identity",
  "tls-generation",
  "tls-selector",
  "corruption-replacement",
] as const;

const publisherMetadataFields = [
  "owner",
  "protocol",
  "validator",
  "boundary",
  "recovery",
  "acknowledgment",
] as const;

const storageClassificationIds = [
  "sqlite-authority",
  "scratch-diagnostics-downloads",
  "client-local",
  "user-destination-copies",
] as const;

const immutablePublicationSteps = [
  "same-parent-stage",
  "close-writers",
  "pre-validate",
  "flush-files",
  "publish",
  "post-validate",
  "preserve-collision",
] as const;

const requiredStepsByProtocol: Record<string, readonly string[]> = {
  "immutable-file": immutablePublicationSteps,
  "validated-tree": immutablePublicationSteps,
  "rebuildable-file": [
    "same-parent-stage",
    "close-writers",
    "pre-validate",
    "flush-files",
    "replace",
    "post-validate",
  ],
  "authority-generation": [
    "materialize-closure",
    "validate-envelope",
    "flush-files",
    "seal-generation",
    "publish",
    "replace-selector",
    "startup-equivalent-resolve",
    "retain-predecessor",
  ],
};

export function loadPublisherManifest(
  path = new URL(
    "../../../docs/authoritative-publishers.json",
    import.meta.url,
  ),
): PublisherManifest {
  return JSON.parse(readFileSync(path, "utf8")) as PublisherManifest;
}

export function validatePublisherManifest(manifest: PublisherManifest): void {
  if (manifest.schemaVersion !== 1) {
    throw new Error(
      "publisher manifest schemaVersion is missing or unsupported",
    );
  }

  const publisherById = new Map(
    manifest.publishers.map(publisher => [publisher.id, publisher]),
  );

  for (const id of authoritativePublisherIds) {
    const publisher = publisherById.get(id);
    if (!publisher) {
      throw new Error(`authoritative publisher is missing: ${id}`);
    }

    for (const field of publisherMetadataFields) {
      if (!publisher[field]?.trim()) {
        throw new Error(`${id} is missing ${field}`);
      }
    }

    const requiredSteps = requiredStepsByProtocol[publisher.protocol];
    if (!requiredSteps) {
      throw new Error(`${id} has unknown protocol ${publisher.protocol}`);
    }

    for (const step of requiredSteps) {
      if (!publisher.steps.includes(step)) {
        throw new Error(`${id} is missing protocol step ${step}`);
      }
    }
  }

  if (publisherById.size !== authoritativePublisherIds.length) {
    throw new Error(
      "publisher manifest contains an unrecognized authoritative publisher",
    );
  }

  for (const id of storageClassificationIds) {
    const entry = manifest.classifications.find(
      candidate => candidate.id === id,
    );
    if (!entry?.classification || !entry.reason) {
      throw new Error(`storage classification is missing: ${id}`);
    }
  }
}
