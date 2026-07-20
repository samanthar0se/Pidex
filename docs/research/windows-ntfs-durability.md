# Fixed-Local-NTFS Durability Boundaries for Pidex

## Executive Summary

Pidex cannot derive a database-style sudden-power-loss guarantee from documented Win32 or NTFS behavior alone.

For a fixed local NTFS volume, Microsoft documents mechanisms to:

- Flush file data from Windows buffers toward the storage device.
- Request write-through behavior.
- Replace or rename files on the same volume.
- Recover NTFS to a consistent filesystem state after interruption.

Microsoft does **not** document that `ReplaceFileW` or same-volume `MoveFileExW` provides a crash-atomic, power-loss-durable transition where the visible file is guaranteed to be exactly the complete old version or complete new version.

The strongest defensible architecture therefore combines:

1. Immutable, checksummed generations.
2. Explicit flushing before publication.
3. Same-volume publication.
4. Retention of older valid generations.
5. Deterministic startup validation and recovery.
6. Hardware qualification when durability against physical power removal is a requirement.

Stock Node.js can implement the portable recovery-oriented core, including writing, `fsync`, and same-volume rename. It cannot request `MOVEFILE_WRITE_THROUGH`, inspect all relevant storage properties, or establish the missing NTFS power-loss guarantees through its documented `fs` API.

---

## Guarantee Boundary

### What Can Be Claimed

Subject to successful API calls:

- Pidex can write a candidate generation and ask Windows to flush its buffered file information to the device with `FlushFileBuffers`.
- Pidex can publish a candidate through a same-volume rename or replacement.
- Pidex can retain independently validated generations and recover by selecting a valid generation at startup.
- NTFS recovery is intended to restore filesystem consistency after system failure.
- Pidex can detect that a path reports NTFS and a `DRIVE_FIXED` logical drive type.

Primary sources:

- [FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)
- [MoveFileExW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw)
- [ReplaceFileW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew)
- [NTFS overview](https://learn.microsoft.com/en-us/windows-server/storage/file-server/ntfs-overview)
- [GetVolumeInformationW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getvolumeinformationw)
- [GetDriveTypeW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getdrivetypew)

### What Cannot Be Claimed from These Contracts

Pidex cannot claim that:

- A completed `ReplaceFileW` is power-loss atomic.
- A completed same-volume `MoveFileExW` replacement survives arbitrary sudden power loss.
- A parent-directory flush durably commits a namespace update on NTFS.
- NTFS journal replay preserves the latest application contents or publication pointer.
- `FlushFileBuffers` proves that data reached nonvolatile media.
- `DRIVE_FIXED` proves that storage is local, physical, non-removable, or safely power-loss protected.
- Successful VM power-cut testing certifies physical disks, controllers, firmware, or host storage.

Absence of such guarantees matters: none of the relevant Microsoft API contracts specifies the post-power-loss state as “exactly old or new.”

---

## Filesystem Guarantees

### NTFS Recovery

NTFS logging protects filesystem recoverability and consistency. It should not be treated as an application write-ahead log or durable commit record.

The USN change journal records filesystem changes for consumers such as indexing and backup software; it is not documented as an application transaction mechanism.

Primary sources:

- [NTFS overview](https://learn.microsoft.com/en-us/windows-server/storage/file-server/ntfs-overview)
- [Change journals](https://learn.microsoft.com/en-us/windows/win32/fileio/change-journals)

### File Flushing

`FlushFileBuffers` flushes buffered information for an open file to the device. The handle must have write access. Closing a file is not, by itself, a documented equivalent.

A successful flush is best described as a Windows cache-level durability fence toward the device—not proof of persistence through arbitrary hardware power loss.

Primary sources:

- [FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)
- [Flushing system-buffered I/O](https://learn.microsoft.com/en-us/windows/win32/fileio/flushing-system-buffered-i-o-data-to-disk)

### Rename and Replacement

`ReplaceFileW` performs a same-volume file replacement, but:

- Its documentation does not specify crash or sudden-power-loss outcomes.
- `REPLACEFILE_WRITE_THROUGH` is explicitly unsupported.
- Documented failure modes can leave files under different names.

`MoveFileExW` supports replacement with `MOVEFILE_REPLACE_EXISTING`. Cross-volume moves permitted by `MOVEFILE_COPY_ALLOWED` degrade to copy-and-delete and must not be treated as atomic publication.

`MOVEFILE_WRITE_THROUGH` prevents the operation from returning until the move completes. Microsoft explicitly describes flushing at the end of a copy-and-delete move, but does not clearly define stronger stable-media semantics for a same-volume namespace replacement. It therefore must not be promoted as proof of power-loss-durable rename.

Primary sources:

- [ReplaceFileW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew)
- [Alternatives to Transactional NTFS](https://learn.microsoft.com/en-us/windows/win32/fileio/deprecation-of-txf)
- [MoveFileExW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw)

### Directory Flushing

Windows documents opening directory handles with `FILE_FLAG_BACKUP_SEMANTICS`, but does not document `FlushFileBuffers` as a supported durability operation for directory namespace changes.

A directory flush may work in tested configurations, but it cannot form part of Pidex’s documented guarantee without a supporting Microsoft contract.

Primary sources:

- [Obtaining a handle to a directory](https://learn.microsoft.com/en-us/windows/win32/fileio/obtaining-a-handle-to-a-directory)
- [CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)
- [FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)

---

## Hardware Boundary

Windows system caching and device write caching are separate durability layers.

- `FILE_FLAG_WRITE_THROUGH` requests write-through behavior.
- `FILE_FLAG_NO_BUFFERING` bypasses Windows data caching but does not bypass hardware caches; filesystem metadata can still be cached.
- Combining no-buffering and write-through causes Windows to request persistence behavior from the device, but Microsoft warns that hardware support varies.
- Storage write-cache properties can expose cache and battery information, but Microsoft documents limitations for RAID and flash devices.

Consequently, a correct application protocol can still lose acknowledged writes if a device, bridge, controller, hypervisor, or firmware cache mishandles flushes or lacks power-loss protection.

Primary sources:

- [File buffering](https://learn.microsoft.com/en-us/windows/win32/fileio/file-buffering)
- [File caching](https://learn.microsoft.com/en-us/windows/win32/fileio/file-caching)
- [Querying write-cache properties](https://learn.microsoft.com/en-us/windows-hardware/drivers/storage/querying-for-the-write-cache-property)
- [STORAGE_WRITE_CACHE_PROPERTY](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntddstor/ns-ntddstor-_storage_write_cache_property)

---

## Environment Detection

There is no single Windows predicate for “fixed, local, physical NTFS with trustworthy persistence.”

Layered detection can establish narrower facts:

| Question | Mechanism | Limitation |
|---|---|---|
| Does the volume report NTFS? | `GetVolumeInformationW` | Does not characterize hardware durability. |
| Does Windows classify the logical drive as fixed? | `GetDriveTypeW` | Fixed media can include flash and virtualized storage. |
| Which volume contains the path? | `GetVolumePathNameW`, `GetVolumeNameForVolumeMountPointW` | Identifies the volume, not persistence quality. |
| Which disks back the volume? | `IOCTL_VOLUME_GET_VOLUME_DISK_EXTENTS` | A volume can span multiple disks. |
| What device characteristics are reported? | `IOCTL_STORAGE_QUERY_PROPERTY` | Reports can be incomplete or unsuitable for RAID, flash, and virtual devices. |

Primary sources:

- [GetVolumeInformationW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getvolumeinformationw)
- [GetDriveTypeW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getdrivetypew)
- [GetVolumePathNameW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getvolumepathnamew)
- [GetVolumeNameForVolumeMountPointW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getvolumenameforvolumemountpointw)
- [IOCTL_VOLUME_GET_VOLUME_DISK_EXTENTS](https://learn.microsoft.com/en-us/windows/win32/api/winioctl/ni-winioctl-ioctl_volume_get_volume_disk_extents)
- [IOCTL_STORAGE_QUERY_PROPERTY](https://learn.microsoft.com/en-us/windows/win32/api/winioctl/ni-winioctl-ioctl_storage_query_property)
- [STORAGE_DEVICE_DESCRIPTOR](https://learn.microsoft.com/en-us/windows/win32/api/winioctl/ns-winioctl-storage_device_descriptor)
- [STORAGE_BUS_TYPE](https://learn.microsoft.com/en-us/windows/win32/api/winioctl/ne-winioctl-storage_bus_type)

Unknown, virtual, RAID, USB, or otherwise ambiguous configurations should be classified as **indeterminate**, not silently accepted as durable physical storage.

---

## Stock Node.js Assessment

### Supported

Node’s documented filesystem APIs are sufficient to:

- Open and write a generation file.
- Flush it through `fs.fsync()` or APIs supporting `{ flush: true }`.
- Close it.
- Rename it with `fs.rename()`.
- Scan, validate, and recover retained generations.

Node’s Windows implementation maps:

- File opening through libuv to `CreateFileW`.
- `fsync` through libuv to `FlushFileBuffers`.
- Rename through libuv to `MoveFileExW(..., MOVEFILE_REPLACE_EXISTING)`.

Primary sources:

- [Node.js `fs.open`](https://nodejs.org/download/release/v22.14.0/docs/api/fs.html#fsopenpath-flags-mode-callback)
- [Node.js `fs.fsync`](https://nodejs.org/download/release/v22.14.0/docs/api/fs.html#fsfsyncfd-callback)
- [Node.js `fs.rename`](https://nodejs.org/download/release/v22.14.0/docs/api/fs.html#fsrenameoldpath-newpath-callback)
- [Node.js flag conversion](https://github.com/nodejs/node/blob/v22.14.0/lib/internal/fs/utils.js#L595-L632)
- [Node.js filesystem bindings](https://github.com/nodejs/node/blob/v22.14.0/src/node_file.cc#L1421-L1555)
- [libuv Windows open implementation](https://github.com/libuv/libuv/blob/v1.49.2/src/win/fs.c#L400-L590)
- [libuv Windows sync and rename implementation](https://github.com/libuv/libuv/blob/v1.49.2/src/win/fs.c#L2077-L2108)

### Not Supported Directly

Stock Node does not expose documented APIs for:

- Adding `MOVEFILE_WRITE_THROUGH` to rename.
- Calling `ReplaceFileW`.
- Reliably requesting and managing specialized Windows handle flags.
- Mapping volumes to every underlying disk.
- Querying device write-cache and power-protection properties.
- Establishing durable parent-directory flush semantics.

A native component could expose these capabilities, but it would still not create a Microsoft-documented old-or-new sudden-power-loss guarantee.

### Conclusion

Stock Node is sufficient for a **recovery-oriented generation protocol**.

It is not sufficient for:

- Hardware qualification.
- Specialized Windows storage inspection.
- Requesting all available write-through flags.
- Proving strict rename durability.

The decision to add native code should therefore depend on needed observability and platform-specific controls—not on an assumption that native code can eliminate the underlying guarantee gap.

---

## Defensible Protocol Baseline

Without selecting the final module interface, the strongest current baseline is:

1. Create a uniquely named generation on the destination volume.
2. Write a self-describing payload containing a format version, generation identifier, length, and checksum.
3. Flush the generation file and handle flush failures as failed writes.
4. Close the generation before publication.
5. Publish only through a same-volume operation.
6. Retain at least one older independently valid generation.
7. Treat the publication pointer as recoverable state rather than the sole source of truth.
8. On startup, validate candidates and deterministically select the newest complete generation.
9. Garbage-collect older generations only after a later successful recovery boundary.

This protocol can guarantee deterministic recovery **if at least one complete generation survives**. It cannot guarantee that the newest acknowledged generation survives arbitrary power loss on unqualified hardware.

---

## Failure Model

| Failure | Defensible expectation |
|---|---|
| Process termination while writing | Temporary or incomplete generation may remain; previously published generations should remain recoverable. |
| Process termination after file flush | Candidate data has crossed the documented Windows file-flush boundary, but may not be published. |
| OS crash during publication | NTFS should recover filesystem consistency; application-visible old/new namespace state is not specified. |
| Sudden physical power loss | Data can be lost from system, controller, device, bridge, or virtual caches; startup recovery must assume any incompletely protected update may be absent or invalid. |
| Torn or corrupted candidate | Checksum, length, and structural validation must reject it. |
| Lost or inconsistent pointer | Recovery must reconstruct the selected generation by scanning retained candidates or another redundant mechanism. |

---

## Validation Strategy

### Physical Certification

Microsoft’s HLK Flush Test is the strongest cited model: write patterns, issue a flush, cut physical power using a controlled PDU, reboot, and verify persisted data over repeated workloads.

- [Microsoft HLK Flush Test](https://learn.microsoft.com/en-us/windows-hardware/test/hlk/testref/2dec1f67-b506-4434-8bdf-763147ad8f0b)

Pidex application tests should additionally verify its own invariants, including generation validity, pointer recovery, monotonic selection, and safe cleanup.

### VM Testing

Hyper-V and VirtualBox hard-power operations are useful for repeatable recovery testing:

- [Hyper-V `Stop-VM`](https://learn.microsoft.com/en-us/powershell/module/hyper-v/stop-vm)
- [Hyper-V `Restart-VM`](https://learn.microsoft.com/en-us/powershell/module/hyper-v/restart-vm)
- [VirtualBox `controlvm poweroff`](https://www.virtualbox.org/manual/topics/vboxmanage.html)

VM success is not physical-device certification. VHDX adds its own logging and recovery layer:

- [VHDX log replay](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-vhdx/0d588e33-23a6-4c71-b27f-87d97ac3e914)
- [Hyper-V virtual-disk consistency guidance](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/best-practices-analyzer/vhd-format-dynamic-virtual-hard-disks-not-recommended-in-production)

Kernel-crash tools test crash recovery, not abrupt removal of electrical power:

- [Sysinternals NotMyFault](https://learn.microsoft.com/en-us/sysinternals/downloads/notmyfault)

---

## Resolved Contradictions

1. **Directory flushes:** observed success is not a documented durability contract. Exclude directory flushing from guaranteed behavior.
2. **`MOVEFILE_WRITE_THROUGH`:** it is a potentially useful request, but its documentation does not establish power-loss-durable same-volume replacement.
3. **`ReplaceFileW`:** Microsoft recommends it for application-level replacement scenarios, but that does not imply crash-atomic or stable-media semantics.
4. **Fixed drive detection:** `DRIVE_FIXED` is a logical classification, not proof of physical locality or protected storage.
5. **Stock Node sufficiency:** Node is sufficient for generation-based recovery, but not for strict durable rename, storage qualification, or device-cache inspection.
6. **Filesystem versus media durability:** NTFS consistency, Windows cache flushing, and physical persistence are distinct guarantees and must not be conflated.

---

## Confidence

- **High confidence:** The stated Win32, NTFS, Node.js, and libuv contracts establish the documented capability boundary and do not promise an exactly-old-or-new post-power-loss result for file replacement.
- **High confidence:** The recovery-oriented generation protocol is a defensible application design when at least one complete retained generation survives.
- **Medium confidence:** The cited Node.js-to-libuv-to-Win32 implementation mapping is version-specific to the linked Node.js v22.14.0 and libuv v1.49.2 sources; later runtimes require rechecking.
- **Indeterminate:** Physical persistence depends on device, controller, bridge, hypervisor, firmware, and power-protection behavior that API documentation alone cannot certify.

Confidence describes the strength of the documented evidence, not a physical-media certification.

## Caveats

- This record resolves the documented durability boundary and runtime capability question; it does not select the final Pidex module interface.
- All claims about flushing are conditional on successful calls and on storage components honoring the requested behavior.
- Same-volume placement must be enforced; cross-volume copy-and-delete publication is outside the atomic-publication baseline.
- VM or kernel-crash testing can validate recovery logic but cannot certify physical disks, controllers, firmware, or host storage against electrical power removal.
- Unknown, virtual, RAID, USB, or otherwise ambiguous storage should remain **indeterminate** rather than silently receiving the fixed-local-NTFS guarantee.

---

## Next Architecture Questions

Before choosing a final module design, Pidex should decide:

1. What does a successful write acknowledge: acceptance, Windows file flush, publication, recoverability, or qualified-media persistence?
2. Must the latest acknowledged generation survive power loss, or is recovery to an older valid generation acceptable?
3. Is the publication pointer authoritative, advisory, redundant, or reconstructible?
4. How many generations must be retained, and when is deletion safe?
5. Which corruption signals are required: checksum, length, schema validation, sequence number, or duplicated metadata?
6. Are ambiguous storage configurations rejected, warned about, or supported with weaker guarantees?
7. Is native Windows integration needed for diagnostics and write-through requests, or is stock Node plus recovery sufficient?
8. Will hardware qualification be part of Pidex’s support contract?
9. How are same-volume placement and cross-volume misconfiguration enforced?
10. Which failure points must the deterministic test harness inject before physical power-loss testing?

The final interface should be designed only after these guarantee and policy questions are answered.
