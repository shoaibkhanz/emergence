// GitHub through `gh`. Every function takes the repo identity { repo, machine }
// (repo: the git toplevel, where gh runs) and throws Error(gh's message) on failure.
// A gitlab.js would export the same functions.
import { exec } from "herdr";

async function gh(id, args, timeout) {
  const r = await exec("gh", args, { cwd: id.repo, on: id.machine, timeout });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").pop() || `gh exited ${r.code}`);
  return r.stdout;
}
const json = async (id, args) => JSON.parse(await gh(id, args));
// -f sends strings, -F numbers/booleans.
const fields = (o) => Object.entries(o).flatMap(([k, v]) => [typeof v === "string" ? "-f" : "-F", `${k}=${v}`]);

// { nwo: "owner/name", defaultBranch } — throws when the repo has no GitHub remote.
export async function repoInfo(id) {
  const r = await json(id, ["repo", "view", "--json", "nameWithOwner,defaultBranchRef"]);
  return { nwo: r.nameWithOwner, defaultBranch: r.defaultBranchRef?.name || null };
}

export function listPRs(id, state, search) {
  return json(id, ["pr", "list", "--state", state, "--limit", "100", ...(search ? ["--search", search] : []),
    "--json", "number,title,state,isDraft,author,additions,deletions,updatedAt,headRefName"]);
}

export const prDiff = (id, number) => gh(id, ["pr", "diff", String(number)], 120000);

const THREADS = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){
  headRefOid reviewThreads(first:100){nodes{id isResolved isOutdated path line startLine diffSide
  comments(first:50){nodes{id databaseId body author{login} createdAt viewerCanDelete viewerCanUpdate}}}}}}}`;

// { headOid, threads: [{ id, isResolved, isOutdated, path, line, startLine, diffSide, comments: [...] }] }
export async function threads(id, nwo, number) {
  const [owner, name] = nwo.split("/");
  const pr = (await json(id, ["api", "graphql", ...fields({ query: THREADS, owner, name, number })])).data.repository.pullRequest;
  return { headOid: pr.headRefOid, threads: pr.reviewThreads.nodes.map((t) => ({ ...t, comments: t.comments.nodes })) };
}

// payload: { body, commit_id, path, line, side, start_line?, start_side? }
export const createComment = (id, nwo, number, payload) =>
  json(id, ["api", "-X", "POST", `repos/${nwo}/pulls/${number}/comments`, ...fields(payload)]);
export const reply = (id, nwo, number, commentId, body) =>
  json(id, ["api", "-X", "POST", `repos/${nwo}/pulls/${number}/comments/${commentId}/replies`, ...fields({ body })]);
export const editComment = (id, nwo, commentId, body) =>
  json(id, ["api", "-X", "PATCH", `repos/${nwo}/pulls/comments/${commentId}`, ...fields({ body })]);
export const deleteComment = (id, nwo, commentId) =>
  gh(id, ["api", "-X", "DELETE", `repos/${nwo}/pulls/comments/${commentId}`]);

const RESOLVE = (verb) => `mutation($id:ID!){${verb}(input:{threadId:$id}){thread{id isResolved}}}`;
export const resolveThread = (id, threadId) => gh(id, ["api", "graphql", ...fields({ query: RESOLVE("resolveReviewThread"), id: threadId })]);
export const unresolveThread = (id, threadId) => gh(id, ["api", "graphql", ...fields({ query: RESOLVE("unresolveReviewThread"), id: threadId })]);
