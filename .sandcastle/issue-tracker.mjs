import { readdir, readFile, writeFile } from "node:fs/promises";

const issueDirectory = new URL(
  "../.scratch/pidex-v1-implementation/issues/",
  import.meta.url,
);

const [command, issueId] = process.argv.slice(2);

const issueFiles = (await readdir(issueDirectory))
  .filter((fileName) => /^\d+-.*\.md$/.test(fileName))
  .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

const parseIssue = async (fileName) => {
  const body = await readFile(new URL(fileName, issueDirectory), "utf8");
  const id = fileName.match(/^(\d+)-/)?.[1];
  const title = body.match(/^#\s+\d+\s+[—-]\s+(.+)$/m)?.[1]?.trim();
  const status = body.match(/^\*\*Status:\*\*\s*(.+)$/m)?.[1]?.trim();

  if (!id || !title || !status) {
    throw new Error(`Invalid issue metadata in ${fileName}`);
  }

  return { id, number: Number(id), title, body, status, fileName };
};

const findIssue = async (id) => {
  if (!id) {
    throw new Error(`The ${command} command requires an issue ID`);
  }

  const normalizedId = id.replace(/^#/, "").padStart(2, "0");
  const fileName = issueFiles.find(
    (candidate) => candidate.match(/^(\d+)-/)?.[1] === normalizedId,
  );

  if (!fileName) {
    throw new Error(`Issue ${id} was not found`);
  }

  return parseIssue(fileName);
};

switch (command) {
  case "list": {
    const issues = await Promise.all(issueFiles.map(parseIssue));
    const openIssues = issues
      .filter((issue) => issue.status === "ready-for-agent")
      .map(({ id, number, title, body }) => ({ id, number, title, body }));
    console.log(JSON.stringify(openIssues));
    break;
  }
  case "view": {
    const issue = await findIssue(issueId);
    process.stdout.write(issue.body);
    break;
  }
  case "close": {
    const issue = await findIssue(issueId);
    if (issue.status === "resolved") {
      console.log(`Issue ${issue.id} is already resolved.`);
      break;
    }
    if (issue.status !== "ready-for-agent") {
      throw new Error(
        `Issue ${issue.id} cannot be resolved from status ${issue.status}`,
      );
    }

    const updatedBody = issue.body.replace(
      /^\*\*Status:\*\*\s*ready-for-agent$/m,
      "**Status:** resolved",
    );
    await writeFile(new URL(issue.fileName, issueDirectory), updatedBody, "utf8");
    console.log(`Resolved issue ${issue.id}: ${issue.title}`);
    break;
  }
  default:
    throw new Error("Usage: issue-tracker.mjs <list|view|close> [issue-id]");
}
