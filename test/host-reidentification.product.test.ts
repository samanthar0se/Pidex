import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { HostReidentification } from "../packages/host/src/host-reidentification.js";

test("reidentification gates recovery, exports first, and establishes a wholly new trust basis", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-reidentify-"));
  try {
    await mkdir(join(root, "generations", "old"), { recursive: true });
    const authority = join(root, "generations", "old", "authority.sqlite");
    const authorityDatabase = new DatabaseSync(authority);
    authorityDatabase.exec(
      "CREATE TABLE devices(id TEXT); INSERT INTO devices VALUES ('phone'); CREATE TABLE recovery(event TEXT, old_host TEXT, new_host TEXT, epoch TEXT)",
    );
    authorityDatabase.close();

    const calls: string[] = [];
    let portableIdentity = false;
    let hostKey = false;
    let caKey = true;
    let exportFails = false;
    const reidentification = new HostReidentification({
      root,
      authority,
      oldIdentity: { hostId: "old-host", origin: "https://old.pidex.local" },
      localhost: () => true,
      trust: () => ({ hostKey, caKey, portableIdentity }),
      verifyAuthority: () => true,
      createVerifiedExport: async () => {
        calls.push("export");
        if (exportFails) {
          throw new Error("export-interrupted");
        }
        return { id: "backup-1", encrypted: true, verified: true };
      },
      issueIdentity: () => {
        calls.push("identity");
        return {
          hostId: "new-host",
          origin: "https://new.pidex.local",
          ca: "new-private-ca",
        };
      },
      reconcile: (copy, epoch) => {
        calls.push("reconcile");
        copy.exec("DELETE FROM devices");
        copy
          .prepare(
            "INSERT INTO recovery VALUES ('cryptographic-continuity-ended', 'old-host', 'new-host', ?)",
          )
          .run(epoch);
      },
      activateTrust: identity => calls.push(`trust:${identity.origin}`),
    });

    assert.throws(
      () => reidentification.preview({ localhost: false }),
      /host-local-recovery-required/,
    );
    portableIdentity = true;
    assert.throws(
      () => reidentification.preview({ localhost: true }),
      /portable-identity-restore-required/,
    );
    portableIdentity = false;
    hostKey = true;
    caKey = false;
    assert.match(
      reidentification.preview({ localhost: true }).confirmation,
      /END CONTINUITY/,
    );
    hostKey = false;
    caKey = true;
    const preview = reidentification.preview({ localhost: true });
    assert.match(preview.consequences.join(" "), /not rotation|not a rotation/i);
    assert.match(preview.consequences.join(" "), /fresh pairing/i);

    exportFails = true;
    await assert.rejects(
      () => reidentification.commit(preview.confirmation),
      /export-interrupted/,
    );
    assert.deepEqual(calls, ["export"]);
    exportFails = false;
    const result = await reidentification.commit(preview.confirmation);
    assert.equal(result.identity.origin, "https://new.pidex.local");
    assert.deepEqual(calls, [
      "export",
      "export",
      "identity",
      "reconcile",
      "trust:https://new.pidex.local",
    ]);
    const restored = new DatabaseSync(result.authority, { readOnly: true });
    assert.equal(
      restored.prepare("SELECT count(*) AS count FROM devices").get()!.count,
      0,
    );
    assert.equal(
      restored.prepare("SELECT event FROM recovery").get()!.event,
      "cryptographic-continuity-ended",
    );
    restored.close();

    const pairing = new DatabaseSync(result.authority);
    pairing.exec("INSERT INTO devices VALUES ('freshly-paired-phone')");
    assert.equal(
      pairing.prepare("SELECT count(*) AS count FROM devices").get()!.count,
      1,
    );
    pairing.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("corrupt authority permits only an encrypted, exact, non-restorable evidence package", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-evidence-"));
  try {
    const damaged = join(root, "damaged.sqlite");
    const intact = join(root, "blob");
    await writeFile(damaged, "damaged rows must remain opaque");
    await writeFile(intact, "intact store");
    const reidentification = new HostReidentification({
      root,
      authority: damaged,
      oldIdentity: { hostId: "old", origin: "https://old" },
      localhost: () => true,
      trust: () => ({ hostKey: false, caKey: false, portableIdentity: false }),
      verifyAuthority: () => false,
      createVerifiedExport: async () => ({
        id: "unused",
        encrypted: true,
        verified: true,
      }),
      issueIdentity: () => ({ hostId: "new", origin: "https://new", ca: "ca" }),
      reconcile: () => {},
      activateTrust: () => {},
    });
    assert.throws(
      () => reidentification.preview({ localhost: true }),
      /authority-reference-closure-failed/,
    );
    const evidence = await reidentification.exportEvidence({
      localhost: true,
      passphrase: "secret",
      files: [damaged, intact],
      manifests: [{ generation: "damaged", status: "failed-integrity" }],
      diagnostics: ["integrity_check failed"],
    });
    assert.equal(evidence.restorable, false);
    assert.equal(evidence.label, "NON-RESTORABLE EVIDENCE");
    const packageBytes = await readFile(evidence.path);
    assert.notEqual(
      createHash("sha256").update(packageBytes).digest("hex"),
      "",
    );
    assert.doesNotMatch(packageBytes.toString(), /damaged rows|intact store/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
