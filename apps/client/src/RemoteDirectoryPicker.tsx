import { asyncDataLoaderFeature, hotkeysCoreFeature, selectionFeature } from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import { ChevronRight, Folder, HardDrive } from "lucide-react";
import { useState } from "react";
import type { ClientStore, DirectoryFact, ProjectFact, WorkspaceFact } from "./client-store.js";

interface PickerProps {
  store: ClientStore;
  onCancel(): void;
  onCreated(project: ProjectFact, workspace: WorkspaceFact): void;
}

const root: DirectoryFact = {
  token: "root",
  name: "Host filesystem",
  displayPath: "",
  hasChildren: true,
};

export function RemoteDirectoryPicker({ store, onCancel, onCreated }: PickerProps) {
  const [selected, setSelected] = useState<DirectoryFact>();
  const [projectName, setProjectName] = useState("");
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [error, setError] = useState<string>();

  const tree = useTree<DirectoryFact>({
    rootItemId: root.token,
    getItemName: item => item.getItemData().name,
    isItemFolder: item => item.getItemData().hasChildren,
    createLoadingItemData: () => ({
      token: `loading-${crypto.randomUUID()}`,
      name: "Loading…",
      displayPath: "",
      hasChildren: false,
    }),
    dataLoader: {
      getItem: async itemId => itemId === root.token ? root : root,
      getChildrenWithData: async itemId => {
        const entries = await store.getState().browseDirectories(itemId === root.token ? undefined : itemId);
        return entries.map(entry => ({ id: entry.token, data: entry }));
      },
    },
    onPrimaryAction: item => {
      if (item.getId() !== root.token && !item.isLoading()) {
        const directory = item.getItemData();
        setSelected(directory);
        setProjectName(current => current || directory.name);
      }
    },
    initialState: { expandedItems: [root.token] },
    indent: 18,
    features: [asyncDataLoaderFeature, selectionFeature, hotkeysCoreFeature],
  });

  async function createProject() {
    if (!selected || !projectName.trim()) return;
    setStatus("saving");
    setError(undefined);
    const result = await store.getState().addProject(selected.token, projectName);
    setStatus("idle");
    if (result.kind !== "accepted" || !result.project || !result.workspace) {
      setError(result.kind === "accepted" ? "Host did not return the new Project." : result.reason);
      return;
    }
    onCreated(result.project, result.workspace);
  }

  return <section className="remote-picker" aria-label="Add Project from Host folder">
    <header>
      <div><h2>Add Project</h2><p>Choose a folder on the Host.</p></div>
      <button type="button" onClick={onCancel}>Cancel</button>
    </header>
    <div {...tree.getContainerProps("Host folders")} className="directory-tree">
      {tree.getItems().map(item => {
        const data = item.getItemData();
        return <div {...item.getProps()} key={item.getId()} className={`directory-row ${item.isSelected() ? "selected" : ""}`}
          style={{ paddingLeft: `${item.getItemMeta().level * 18}px` }}>
          <ChevronRight className={item.isExpanded() ? "expanded" : ""} aria-hidden="true"/>
          {item.getItemMeta().level === 0 ? <HardDrive aria-hidden="true"/> : <Folder aria-hidden="true"/>}
          <span>{data.name}</span>
        </div>;
      })}
    </div>
    <div className="picker-selection">
      <span className="selected-path">{selected?.displayPath ?? "Select a Host folder"}</span>
      <label>Project name
        <input value={projectName} disabled={!selected || status === "saving"}
          onChange={event => setProjectName(event.target.value)} />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="button" disabled={!selected || !projectName.trim() || status === "saving"}
        onClick={() => void createProject()}>{status === "saving" ? "Adding…" : "Add Project"}</button>
    </div>
  </section>;
}
