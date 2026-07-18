# TASK

Merge the following branches into the current branch:

{{BRANCHES}}

For each branch:

1. Run `git merge <branch> --no-edit`
2. If there are merge conflicts, resolve them intelligently by reading both sides and choosing the correct resolution
3. After resolving conflicts, run `npm run typecheck` and `npm run test` to verify everything works
4. If tests fail, fix the issues before proceeding to the next branch

# CLOSE ISSUES

For each branch that was merged, close its issue using the following command:

`node .sandcastle/issue-tracker.mjs close <ID>`

Here are all the issues:

{{ISSUES}}

After all branches are merged and their issues are closed, make a single commit containing the issue status updates and summarizing the merged work.

Once you've merged everything you can, output <promise>COMPLETE</promise>.
