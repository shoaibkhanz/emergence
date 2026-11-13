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

const PR_FIELDS = "number,title,state,isDraft,author,additions,deletions,updatedAt,headRefName,baseRefName";
export function listPRs(id, state, search) {
  return json(id, ["pr", "list", "--state", state, "--limit", "100", ...(search ? ["--search", search] : []), "--json", PR_FIELDS]);
}
export const viewPR = (id, number) => json(id, ["pr", "view", String(number), "--json", PR_FIELDS]);

export const prDiff = (id, number) => gh(id, ["pr", "diff", String(number)], 120000);
// Oldest first: [{ oid, headline, author, at }].
export const prCommits = async (id, number) => (await json(id, ["pr", "view", String(number), "--json", "commits"])).commits
  .map((c) => ({ oid: c.oid, headline: c.messageHeadline, author: c.authors?.[0]?.login || c.authors?.[0]?.name || "", at: c.committedDate }));
// One commit's own changes, as a unified diff (it need not be fetched locally).
export const commitDiff = (id, nwo, oid) => gh(id, ["api", "-H", "Accept: application/vnd.github.diff", `repos/${nwo}/commits/${oid}`], 120000);
// A file's text at a ref (a commit or branch).
export const fileAt = (id, nwo, path, ref) =>
  gh(id, ["api", "-H", "Accept: application/vnd.github.raw", `repos/${nwo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`], 120000);

const THREADS = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){
  headRefOid body createdAt author{login}
  comments(last:100){nodes{id databaseId body author{login} createdAt viewerCanDelete viewerCanUpdate}}
  reviews(last:100){nodes{id body state author{login} submittedAt}}
  reviewThreads(first:100){nodes{id isResolved isOutdated path line startLine diffSide
  comments(first:50){nodes{id databaseId body author{login} createdAt viewerCanDelete viewerCanUpdate}}}}}}}`;

// { headOid, threads: [{ id, isResolved, isOutdated, path, line, startLine, diffSide, comments: [...] }],
//   talk: the conversation, oldest first: the description, PR comments, and reviews with a verdict or a note —
//   [{ id, kind: "body" | "comment" | "review", author, at, body, state?, databaseId?, viewerCanUpdate?, viewerCanDelete? }] }
export async function threads(id, nwo, number) {
  const [owner, name] = nwo.split("/");
  const pr = (await json(id, ["api", "graphql", ...fields({ query: THREADS, owner, name, number })])).data.repository.pullRequest;
  const talk = [
    { id: "body", kind: "body", author: pr.author?.login, at: pr.createdAt, body: pr.body },
    ...pr.comments.nodes.map((c) => ({ ...c, kind: "comment", author: c.author?.login, at: c.createdAt })),
    ...pr.reviews.nodes.filter((r) => r.state !== "PENDING" && (r.body || r.state !== "COMMENTED")).map((r) => ({ id: r.id, kind: "review", author: r.author?.login, at: r.submittedAt, body: r.body, state: r.state })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { headOid: pr.headRefOid, threads: pr.reviewThreads.nodes.map((t) => ({ ...t, comments: t.comments.nodes })), talk };
}

// A comment on the pull request itself, not on a line.
export const postComment = (id, nwo, number, body) => json(id, ["api", "-X", "POST", `repos/${nwo}/issues/${number}/comments`, ...fields({ body })]);

// payload: { body, commit_id, path, line, side, start_line?, start_side? }
export const createComment = (id, nwo, number, payload) =>
  json(id, ["api", "-X", "POST", `repos/${nwo}/pulls/${number}/comments`, ...fields(payload)]);
export const reply = (id, nwo, number, commentId, body) =>
  json(id, ["api", "-X", "POST", `repos/${nwo}/pulls/${number}/comments/${commentId}/replies`, ...fields({ body })]);
// where: "pulls" for a review comment (on a line), "issues" for one on the PR itself.
export const editComment = (id, nwo, commentId, body, where = "pulls") =>
  json(id, ["api", "-X", "PATCH", `repos/${nwo}/${where}/comments/${commentId}`, ...fields({ body })]);
export const deleteComment = (id, nwo, commentId, where = "pulls") =>
  gh(id, ["api", "-X", "DELETE", `repos/${nwo}/${where}/comments/${commentId}`]);

const RESOLVE = (verb) => `mutation($id:ID!){${verb}(input:{threadId:$id}){thread{id isResolved}}}`;
export const resolveThread = (id, threadId) => gh(id, ["api", "graphql", ...fields({ query: RESOLVE("resolveReviewThread"), id: threadId })]);
export const unresolveThread = (id, threadId) => gh(id, ["api", "graphql", ...fields({ query: RESOLVE("unresolveReviewThread"), id: threadId })]);
