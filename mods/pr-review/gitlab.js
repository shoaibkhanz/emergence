// GitLab through `glab` (REST v4 via `glab api`): the same functions and shapes as github.js, so the panel has one
// code path. `:id` is glab's placeholder for the repo's project; extra trailing args some calls take here (the thread
// id for a reply, the MR number for edits, deletes and resolves) are ignored by github.js.
import { exec } from "herdr";
import { mapMR, glStates, mapThreads, commitDiffText, position, versionFor } from "./gitlab-map.js";

async function glab(id, args, timeout) {
  const r = await exec("glab", args, { cwd: id.repo, on: id.machine, timeout });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").pop() || `glab exited ${r.code}`);
  return r.stdout;
}
// ndjson: one item per line, every page (`--paginate` alone glues pages together as `][`).
const api = async (id, path) =>
  (await glab(id, ["api", "--paginate", "--output", "ndjson", path])).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const one = async (id, path) => (await api(id, path))[0];
// Writes (a comment body, maybe more fields): glab refuses --paginate on anything but GET.
const send = async (id, method, path, body, more = []) => JSON.parse((await glab(id, ["api", "-X", method, path, "-f", `body=${body}`, ...more])) || "null");
const mr = (n) => `projects/:id/merge_requests/${n}`;

export async function repoInfo(id) {
  const r = JSON.parse(await glab(id, ["repo", "view", "-F", "json"]));
  return { nwo: r.path_with_namespace, defaultBranch: r.default_branch || null };
}

export async function listPRs(id, state, search) {
  const q = search ? `&search=${encodeURIComponent(search)}` : "";
  // One page a state, the 100 last updated, as gh's --limit 100: --paginate would walk every MR the project ever had.
  const lists = await Promise.all(glStates(state).map(async (s) => JSON.parse(await glab(id, ["api", `projects/:id/merge_requests?state=${s}&per_page=100&order_by=updated_at${q}`]))));
  return lists.flat().map(mapMR).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
export const viewPR = async (id, number) => mapMR(await one(id, mr(number)));

export const prDiff = (id, number) => glab(id, ["mr", "diff", String(number), "--raw"], 120000);
// Oldest first, as github.js.
export const prCommits = async (id, number) => (await api(id, `${mr(number)}/commits`)).reverse()
  .map((c) => ({ oid: c.id, headline: c.title, author: c.author_name || "", at: c.committed_date }));
export const commitDiff = async (id, _nwo, oid) => commitDiffText(await api(id, `projects/:id/repository/commits/${oid}/diff`));
export const fileAt = (id, _nwo, path, ref) =>
  glab(id, ["api", `projects/:id/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(ref)}`], 120000);

const me = new Map(); // repo → the signed-in user there, asked once (two repos can be on two hosts or accounts)
export async function threads(id, _nwo, number) {
  const [discussions, m] = await Promise.all([api(id, `${mr(number)}/discussions`), one(id, mr(number))]);
  const key = `${id.machine}|${id.repo}`;
  if (!me.has(key)) me.set(key, (await one(id, "user")).username);
  return mapThreads(discussions, m, me.get(key));
}

export const postComment = (id, _nwo, number, body) => send(id, "POST", `${mr(number)}/notes`, body);

// payload as github.js's plus anchor ({ start, end } rows' { old, new }) and old_path. Placed on the MR version its
// commit_id belongs to; a range carries line codes (sha1 of the path).
export async function createComment(id, _nwo, number, payload) {
  const v = versionFor(await api(id, `${mr(number)}/versions`), payload.commit_id);
  let lineCode = null;
  if (payload.start_line != null) {
    // sha1sum (coreutils) or shasum (perl, macOS): a machine may have only one.
    const sha = (await exec("sh", ["-c", 'printf %s "$1" | { sha1sum 2>/dev/null || shasum -a 1; }', "sh", payload.path], { on: id.machine })).stdout.split(" ")[0];
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("A range needs sha1sum or shasum on that machine; comment on one line instead.");
    lineCode = (o, n) => `${sha}_${o}_${n}`;
  }
  return send(id, "POST", `${mr(number)}/discussions`, payload.body, ["-F", `position=${JSON.stringify(position(payload, v, lineCode))}`]);
}
export const reply = (id, _nwo, number, _commentId, body, threadId) =>
  send(id, "POST", `${mr(number)}/discussions/${threadId}/notes`, body);
export const editComment = (id, _nwo, commentId, body, _where, number) => send(id, "PUT", `${mr(number)}/notes/${commentId}`, body);
export const deleteComment = (id, _nwo, commentId, _where, number) => glab(id, ["api", "-X", "DELETE", `${mr(number)}/notes/${commentId}`]);
const resolve = (resolved) => (id, threadId, _nwo, number) => glab(id, ["api", "-X", "PUT", `${mr(number)}/discussions/${threadId}`, "-F", `resolved=${resolved}`]);
export const resolveThread = resolve(true);
export const unresolveThread = resolve(false);
