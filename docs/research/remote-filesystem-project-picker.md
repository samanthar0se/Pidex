# Remote Filesystem Picker for Adding a Project

## Research question

Which current libraries and browser approaches could support a React Client picker that explores the Pidex Host's filesystem and uses a selected directory to add a new Project?

Research was performed on 2026-07-23 against primary sources: project documentation and repositories, web specifications, and the local Pidex architecture.

This note is also the implementation specification for the initial remote
filesystem picker slice. The accepted implementation decisions below supersede
conflicting general guidance for this slice.

## Executive summary

Use a **server-driven directory tree built with Headless Tree**, behind a small Pidex-owned adapter. Do not use the browser File System Access API as the primary mechanism.

The important boundary is not the tree widget. The React Client may be running on another Device, while the Host owns filesystem access and domain authority. The Host therefore must enumerate its own filesystem through an authenticated, typed API; the Client tree renders those results and returns a Host-recognized directory locator or opaque selection token. Browser-native pickers select storage exposed by the browser's operating environment, not an arbitrary Pidex Host. [S1](https://wicg.github.io/file-system-access/#local-file-system) [L1](../../.scratch/pidex-product-and-architecture/SPEC.md#L116-L127)

There is also a domain-model correction to preserve in the design: a **Project is a durable logical grouping**, while a **Workspace is a concrete working copy or execution environment**. A filesystem directory is therefore naturally a Workspace locator, not Project identity. An “Add Project from folder” flow may create a Project and its initial Workspace together, but the selected path should be stored on the Workspace side of that relationship. Paths are locators, never durable identities. [L2](../../.scratch/pidex-product-and-architecture/SPEC.md#L75-L88)

## Current Pidex fit

Pidex already uses React 19 and Vite, so the relevant candidates are React tree primitives rather than desktop-native dialog packages. [L3](../../package.json#L39-L45) The current new-Session surface accepts raw Project and Workspace identifiers, and the current public summaries expose only IDs and names. No directory picker, Workspace path locator, or Project-creation contract exists yet. [L4](../../apps/client/src/App.tsx#L122-L133) [L5](../../packages/protocol/src/status.ts#L137-L149)

The existing authority rules constrain the solution:

- The Host is the sole authority for shared state; the PWA renders projections and issues commands rather than becoming an authority. [L6](../../.scratch/pidex-product-and-architecture/SPEC.md#L116-L127) [L7](../../.scratch/pidex-product-and-architecture/SPEC.md#L270-L301)
- Projects, Workspaces, APIs, WebSockets, and commands require Device authentication. Directory names and paths are at least as sensitive and must use that same boundary. [L8](../../.scratch/pidex-product-and-architecture/SPEC.md#L364-L373)
- V1 deliberately trusts every paired Device with the signed-in Windows user's filesystem authority and adds no Project, Workspace, or path trust gate. The picker must accurately disclose and implement that policy; it should not invent a cosmetic Client-side permission boundary. [L8](../../.scratch/pidex-product-and-architecture/SPEC.md#L364-L373) [L9](../../.scratch/pidex-product-and-architecture/SPEC.md#L408-L416)
- Authenticated HTTP responses use `no-store`, and cached Client projections are not authority. Filesystem browse results should likewise be ephemeral discovery data, not an offline-capable authoritative tree. [L10](../../.scratch/pidex-product-and-architecture/SPEC.md#L469-L475)

## Accepted implementation decisions

The initial slice deliberately makes the following bounded tradeoffs:

1. **Fresh authority only.** Adding the Workspace directory locator may change
   the current authority schema in place without a migration or schema-version
   increment. Compatibility with an authority database created before this
   slice is outside scope; development installations may start with a fresh
   authority.
2. **One current Client generation.** `directory.browse`,
   `project.add-from-directory`, and `project.created` are part of the current
   Client/Host protocol generation. The Host does not filter
   `project.created` delivery for older Clients or provide mixed-version
   degradation. Clients from before this slice are unsupported and must be
   upgraded with the Host.
3. **Host-enforced availability.** The Add Project entry point does not require
   a separate negotiated-capability visibility rule or a continuously current
   Client-authority gate. It may remain visible while editing; the Client
   adapter and Host may reject browsing or creation when unavailable,
   incompatible, or non-current, and the picker must surface that operational
   failure.
4. **Focused verification.** Acceptance requires type checking, a production
   Client build, a Client-store test, and a Host product test covering browse,
   forged-token rejection, atomic Project/Workspace creation, and restart
   persistence. New React Testing Library focus/keyboard coverage, responsive
   captures, and updates to `docs/frontend-experience/review-evidence.md` are
   not required for this initial slice.

## Candidate comparison

| Candidate | Remote/lazy data | Accessibility and styling | License / cost | Pidex fit |
|---|---|---|---|---|
| **Headless Tree** (`@headless-tree/core`, `@headless-tree/react`) | First-class synchronous and asynchronous data loaders; optional async caching; its flat node model can be virtualized. [S2](https://headless-tree.lukasbach.com/) [S3](https://headless-tree.lukasbach.com/getstarted/) | Headless DOM and styling suit Pidex's custom shell. It supplies container/item accessibility props, ARIA structure, keyboard features, selection, and typeahead. [S3](https://headless-tree.lukasbach.com/getstarted/) | MIT; feature imports are tree-shakeable and the repository describes the core as dependency-free. [S4](https://github.com/lukasbach/headless-tree) | **Best fit.** The async loader maps directly to `listChildren`, while Pidex keeps rendering, loading/error states, and all domain actions under its control. |
| **React Aria Tree** (`react-aria-components`) | Supports dynamic nested collections, unloaded-child markers, and multi-level asynchronous loading via `TreeLoadMoreItem`; the application chooses its fetching layer. [S5](https://react-aria.adobe.com/Tree) [S6](https://react-spectrum.adobe.com/v3/releases/2025-07-22.html) | Strongest accessibility pedigree in this set: built-in keyboard/selection behavior, custom CSS, and mouse, touch, keyboard, and screen-reader interactions. Tree and Virtualizer reached GA in March 2025. [S5](https://react-aria.adobe.com/Tree) [S7](https://react-spectrum.adobe.com/v3/releases/2025-03-05.html) | Apache-2.0. [S8](https://github.com/adobe/react-spectrum/blob/main/LICENSE) | **Best conservative alternative.** Prefer it if accessibility maturity and a large maintained ecosystem outweigh Headless Tree's smaller, more direct data-loader surface. More application code is needed to adapt expand-on-demand directory reads. |
| **React Arborist** (`react-arborist`) | Controlled trees let Pidex own the data, and rendering is virtualized, but remote loading, request state, and caching are application responsibilities rather than a remote data-source contract. [S9](https://github.com/jameskerr/react-arborist#features) | Custom rendering, keyboard navigation, ARIA attributes, filtering, and selection are included. It also brings file-manager features such as drag/drop and inline rename. [S9](https://github.com/jameskerr/react-arborist#features) | MIT. [S10](https://github.com/jameskerr/react-arborist/blob/main/LICENSE) | **Viable but less focused.** Good for a later full explorer; excessive for a read-only choose-a-directory flow, and remote-state integration remains ours. |
| **MUI X Rich Tree View Pro** | Its `dataSource.getTreeItems` contract, child counts, cache, error handling, and refresh API are an excellent direct match for server-side lazy loading. [S11](https://mui.com/x/react-tree-view/rich-tree-view/lazy-loading/) | Documented WAI-ARIA tree keyboard behavior and labeling; polished Material UI rendering. [S12](https://mui.com/x/react-tree-view/accessibility/) | Server lazy loading and virtualization are Pro features. The Community package is MIT, but the relevant Pro package requires a commercial license and also pulls Pidex into the MUI styling/package stack. [S13](https://mui.com/x/react-tree-view/) [S14](https://mui.com/x/introduction/licensing/) | **Technically strong, strategically poor.** Choose only if Pidex separately adopts MUI and accepts a recurring commercial dependency. |
| **DevExtreme React FileManager** | A turnkey remote filesystem provider supports server endpoints and custom providers, plus upload/download and mutation operations. [S15](https://js.devexpress.com/React/Documentation/Guide/UI_Components/FileManager/Bind_to_File_Systems/) [S16](https://js.devexpress.com/React/Documentation/ApiReference/UI_Components/dxFileManager/File_System_Providers/Remote/Configuration/) | Full file-manager UI rather than a small headless picker. Mutation permissions can be disabled, but file-manager-specific accessibility evidence is less explicit than for the tree primitives. [S17](https://js.devexpress.com/React/Documentation/ApiReference/UI_Components/dxFileManager/Configuration/permissions/) | Commercial. [S18](https://js.devexpress.com/Licensing/) | **Overbuilt.** Its upload, download, rename, move, and deletion surface expands both product scope and security review without helping the v1 selection task. |

### Why Headless Tree wins

Headless Tree is the narrowest match to the problem:

1. Its async data loader naturally translates a Host directory node into a request for child nodes.
2. It is headless, so Pidex can preserve its quiet custom visual language rather than import Material or a desktop-file-manager theme.
3. Features are opt-in. The picker can include async loading, single selection, accessibility props, and keyboard navigation while excluding rename and drag/drop.
4. Its flat visible-node list admits virtualization later without coupling the Host protocol to a rendering strategy.
5. It has no commercial runtime boundary.

Adoption should still be gated by a small prototype. The official repository currently reports version 1.7.0, while its README still contains a “Beta” notice; that inconsistency is a maintenance-risk signal. [S4](https://github.com/lukasbach/headless-tree) [S19](https://github.com/lukasbach/headless-tree/blob/main/packages/react/package.json) Keep all library-specific state behind a `RemoteDirectoryTree` component so React Aria can replace it without changing Host schemas.

## Why native browser pickers do not solve this

`window.showDirectoryPicker()` is a **local filesystem handle factory**. The specification describes the local filesystem as storage exposed through the user agent; it may include an OS-integrated cloud provider, but it does not let an application redirect the picker to an arbitrary remote server. The returned `FileSystemDirectoryHandle` belongs to the Client browser's environment and permission model. [S1](https://wicg.github.io/file-system-access/#local-file-system)

It also requires a secure, top-level same-origin context and transient user activation, and access is explicitly permission-gated. Browser support remains limited enough that MDN does not classify `showDirectoryPicker()` as Baseline. [S20](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker)

Consequences for Pidex:

- On a phone or another computer, it would select that Device's directory, not the Host's.
- Even when the Client browser happens to run on the Host computer, it would create a second browser-owned permission and persistence model that does not represent Pidex Host authority.
- `<input type="file" webkitdirectory>` is also an upload-oriented selection mechanism for Client-visible files, not remote Host enumeration.

The API could be offered in a future, separately named **import from this Device** workflow. It must not back **add Host Project**.

## Recommended Host/Client contract

The UI library should receive only a presentation model. Pidex owns the remote filesystem adapter and protocol.

### Browse flow

1. An admitted Client starts a short-lived browse session. The Host remains the
   enforcement point and may reject the operation if the connection cannot act.
2. The Host returns selectable roots or useful starting locations. On Windows this may include drive roots, UNC roots already configured by the user, parent directories of existing Workspaces, and recent selections.
3. Expanding a directory calls a bounded operation equivalent to `listChildren(browseSessionId, directoryNodeId, pageCursor)`.
4. The Host enumerates **directories only** for the v1 picker and returns an opaque node ID, display name, normalized display locator, kind, child hint, and continuation cursor. No file contents are returned.
5. The Client holds expansion, focus, loading, retry, and selection state locally. These are View concerns, not durable Host facts.
6. Confirming the selection sends the opaque selection identity with a Device-scoped Command ID. The Host resolves and revalidates it, then creates the logical Project and initial Workspace atomically, or returns a typed rejection.
7. The resulting Project/Workspace appears only through the ordinary authoritative snapshot or Change Set path; the command response must not patch the Client's catalog directly. [L7](../../.scratch/pidex-product-and-architecture/SPEC.md#L270-L301)

This division also avoids making raw client-joined paths a protocol capability. The Client may display a path, but it should not derive child paths by concatenating names.

### Domain shape

The durable model needs an explicit Workspace locator before implementation. A reasonable command shape is conceptually:

```text
project.add-from-directory
  commandId
  projectName
  workspaceName
  selectedDirectoryToken
  browseSessionRevision
```

The Host resolves the token to a directory, creates an opaque Project ID and Workspace ID, and stores the validated directory as Workspace locator/observed state. The path itself must not become either ID. The initial slice stores the Host-canonical directory string directly on the Workspace. Aliases, symlink-preserving display paths, and repository metadata remain future domain decisions.

## Security and robustness requirements

Pidex v1 intentionally grants paired Devices broad authority, but robust filesystem handling is still necessary:

- **Authenticate every browse and confirmation operation.** Never expose roots, names, paths, or errors on discovery, onboarding, or anonymous surfaces. [L8](../../.scratch/pidex-product-and-architecture/SPEC.md#L364-L373)
- **Enforce authority on the Host.** Hiding buttons or filtering nodes in React is presentation, not authorization.
- **Resolve on the Host and revalidate on confirmation.** Check that the target still exists and is a directory immediately before committing the Workspace; browse results can become stale.
- **Treat reparse points deliberately.** Windows reparse points can redirect filesystem operations. Do not auto-expand them; label them, resolve them on the Host, detect traversal cycles, and make the selected effective target clear. [S21](https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-points)
- **Bound work.** Page large directories, cap concurrent expansion requests and response sizes, support cancellation/timeouts, and return typed `access-denied`, `not-found`, `changed`, `unavailable`, and `too-large` outcomes. UNC and disconnected network paths must not hang the Host.
- **Minimize disclosure.** Return directories only, avoid metadata not needed for selection, mark authenticated responses `no-store`, and keep browse caches short-lived and Device/session scoped.
- **Keep the v1 picker read-only.** Disable rename, drag/drop, upload, delete, create-directory, and file preview even when the chosen widget supports them.
- **Meet the tree interaction contract.** A dynamically loaded/virtualized tree needs the WAI-ARIA roles, focus/selection distinction, arrow-key behavior, and explicit position metadata described by the Authoring Practices Guide. [S22](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/)

## Suggested decision

Adopt this direction:

- **UI:** Headless Tree through a Pidex-owned `RemoteDirectoryTree` adapter.
- **Fallback candidate:** React Aria Tree if prototype testing exposes Headless Tree maturity or accessibility problems.
- **Transport:** authenticated, paged, read-only Host directory enumeration plus a preconditioned Project/Workspace creation command.
- **Domain:** the chosen directory becomes a Workspace locator; “Add Project” creates the Project and initial Workspace together.
- **Native APIs:** exclude File System Access and `webkitdirectory` from this Host-browsing workflow.
- **Acceptance gates:** the focused verification listed in
  [Accepted implementation decisions](#accepted-implementation-decisions).
  Windows UNC behavior, reparse-point loops, very large directories,
  keyboard/screen-reader behavior, responsive captures, connection loss, stale
  selection, and exact command reconciliation remain follow-up hardening work
  rather than blockers for the initial slice.

## Sources

- **S1 — File System Access specification:** [WICG File System Access](https://wicg.github.io/file-system-access/#local-file-system).
- **S2 — Headless Tree overview:** [Headless Tree](https://headless-tree.lukasbach.com/).
- **S3 — Headless Tree integration and data loaders:** [Get Started](https://headless-tree.lukasbach.com/getstarted/).
- **S4 — Headless Tree repository, features, license, and maturity note:** [lukasbach/headless-tree](https://github.com/lukasbach/headless-tree).
- **S5 — React Aria Tree API and interaction model:** [React Aria Tree](https://react-aria.adobe.com/Tree).
- **S6 — React Aria multi-level asynchronous Tree loading:** [July 22, 2025 release](https://react-spectrum.adobe.com/v3/releases/2025-07-22.html).
- **S7 — React Aria Tree and Virtualizer GA:** [March 5, 2025 release](https://react-spectrum.adobe.com/v3/releases/2025-03-05.html).
- **S8 — React Spectrum license:** [Apache License 2.0](https://github.com/adobe/react-spectrum/blob/main/LICENSE).
- **S9 — React Arborist features and controlled data:** [jameskerr/react-arborist](https://github.com/jameskerr/react-arborist#features).
- **S10 — React Arborist license:** [MIT License](https://github.com/jameskerr/react-arborist/blob/main/LICENSE).
- **S11 — MUI X server-side lazy loading:** [Rich Tree View — Lazy loading](https://mui.com/x/react-tree-view/rich-tree-view/lazy-loading/).
- **S12 — MUI X Tree View accessibility:** [Accessibility](https://mui.com/x/react-tree-view/accessibility/).
- **S13 — MUI X Tree View feature tiers:** [Tree View overview](https://mui.com/x/react-tree-view/).
- **S14 — MUI X licensing:** [Licensing](https://mui.com/x/introduction/licensing/).
- **S15 — DevExtreme FileManager server binding:** [Bind to File Systems](https://js.devexpress.com/React/Documentation/Guide/UI_Components/FileManager/Bind_to_File_Systems/).
- **S16 — DevExtreme remote provider:** [RemoteFileSystemProvider configuration](https://js.devexpress.com/React/Documentation/ApiReference/UI_Components/dxFileManager/File_System_Providers/Remote/Configuration/).
- **S17 — DevExtreme FileManager permissions:** [Permissions](https://js.devexpress.com/React/Documentation/ApiReference/UI_Components/dxFileManager/Configuration/permissions/).
- **S18 — DevExtreme licensing:** [DevExtreme Licensing](https://js.devexpress.com/Licensing/).
- **S19 — Current Headless Tree React package metadata:** [`@headless-tree/react` package](https://github.com/lukasbach/headless-tree/blob/main/packages/react/package.json).
- **S20 — Browser availability and activation requirements:** [MDN `showDirectoryPicker()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker).
- **S21 — Windows reparse-point semantics:** [Microsoft Reparse Points](https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-points).
- **S22 — Accessible tree semantics and keyboard interaction:** [WAI-ARIA Tree View Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/).
- **L1 — Pidex required components:** `.scratch/pidex-product-and-architecture/SPEC.md#L116-L127`.
- **L2 — Pidex canonical Project, Workspace, and path semantics:** `.scratch/pidex-product-and-architecture/SPEC.md#L75-L88`.
- **L3 — Current Client dependencies:** `package.json#L39-L45`.
- **L4 — Current new-Session Project/Workspace controls:** `apps/client/src/App.tsx#L122-L133`.
- **L5 — Current Project and Workspace summary schemas:** `packages/protocol/src/status.ts#L137-L149`.
- **L6 — PWA authority boundary:** `.scratch/pidex-product-and-architecture/SPEC.md#L116-L127`.
- **L7 — Client/Host consistency rules:** `.scratch/pidex-product-and-architecture/SPEC.md#L270-L301`.
- **L8 — LAN trust and authenticated product boundary:** `.scratch/pidex-product-and-architecture/SPEC.md#L364-L373`.
- **L9 — Paired Device authority and revocation:** `.scratch/pidex-product-and-architecture/SPEC.md#L408-L416`.
- **L10 — Client cache and authenticated HTTP policy:** `.scratch/pidex-product-and-architecture/SPEC.md#L469-L475`.
