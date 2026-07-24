import assert from "node:assert/strict";
import test from "node:test";
import { createClientStore } from "../apps/client/src/client-store.js";

test("Client Project creation installs the authoritative Project and Workspace result", async () => {
  const store = createClientStore({
    host: {
      async readSession() { throw new Error("unused"); },
      async browseDirectories() {
        return [{ token: "directory-token", name: "Code", displayPath: "C:\\Code", hasChildren: true }];
      },
      async addProject(command) {
        assert.equal(command.selectionToken, "directory-token");
        return {
          kind: "accepted",
          project: { projectId: "project-code", name: command.projectName },
          workspace: {
            workspaceId: "workspace-code",
            projectId: "project-code",
            name: command.projectName,
            path: "C:\\Code",
          },
        };
      },
    },
    drafts: { async read() { return ""; }, async write() {} },
    routing: { replace() {} },
    commandIds: () => "add-project-command",
  });

  assert.equal((await store.getState().browseDirectories())[0]?.displayPath, "C:\\Code");
  const result = await store.getState().addProject("directory-token", "Code");
  assert.equal(result.kind, "accepted");
  assert.deepEqual(store.getState().projects, [{ projectId: "project-code", name: "Code" }]);
  assert.equal(store.getState().workspaces[0]?.path, "C:\\Code");
});
