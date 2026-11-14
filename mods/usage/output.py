#!/usr/bin/env python3
"""What the work delivered, for the Usage panel's Output tab: your commits (with lines added and removed),
your pull or merge requests (GitHub via gh, GitLab via glab), and each repo's worktrees, in the repos your agents worked in.

    python3 output.py SINCE_MS REPO...   ->   one JSON document on stdout:
    { "commits":   [{"t": ms, "repo": str, "add": int, "del": int}],
      "prs":       [{"repo": str, "n": int, "created": ms, "merged": ms|null, "add": int, "del": int, "state": str}],
      "worktrees": [{"repo": str, "n": int}] }

Only your own commits (the repo's user.email) and PRs/MRs (@me). A repo that's gone, or gh/glab missing or
signed out, just contributes nothing. Nothing is read beyond counts and timestamps; lockfiles don't count as lines.
"""
import json, os, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

# Generated files that would swamp the line counts (lockfiles, minified bundles).
GENERATED = re.compile(r"(^|/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|uv\.lock|poetry\.lock|Gemfile\.lock|go\.sum|composer\.lock)$|\.min\.(js|css)$")

def run(args, cwd):
    try:
        r = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=60)
        return r.stdout if r.returncode == 0 else ""
    except (OSError, subprocess.TimeoutExpired):
        return ""


# A commit's line counts never change, so each is worked out once (`git show --numstat`, the slow part of a big repo's
# year) and kept in <app>/data/usage/commits.json; later runs list commits cheaply and diff only new ones.
COUNTS_VERSION = 1
BATCH = 200  # commits per `git show`, well under any argv limit


def counts_path():
    app = os.environ.get("HERDR_APP_HOME") or os.path.join(os.path.expanduser("~"), ".config", "herdr-app")
    return os.path.join(app, "data", "usage", "commits.json")


def load_counts(path):
    try:
        with open(path) as f:
            c = json.load(f)
        return c["counts"] if c.get("v") == COUNTS_VERSION else {}
    except (OSError, ValueError, KeyError, AttributeError):
        return {}


def save_counts(path, counts):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump({"v": COUNTS_VERSION, "counts": counts}, f, separators=(",", ":"))
    os.replace(tmp, path)


def numstat(text):
    """`git show --format=%x00%H --numstat` -> {hash: [added, deleted]}, lockfiles and binaries ("-") left out."""
    out = {}
    for chunk in text.split("\0")[1:]:
        lines = chunk.strip().splitlines()
        if not lines:
            continue
        add = dele = 0
        for row in lines[1:]:
            parts = row.split("\t")
            if len(parts) >= 3 and parts[0].isdigit() and parts[1].isdigit() and not GENERATED.search(parts[2]):
                add += int(parts[0]); dele += int(parts[1])
        out[lines[0].strip()] = [add, dele]
    return out


def commit_counts(repo, email, since, known):
    """Your commits since `since` (ms) with their line counts: listed without diffs, and only commits missing from
    `known` ({hash: [add, del]}) diffed. -> (commits, the counts of every commit listed: what's worth keeping)."""
    log = run(["git", "log", "--all", "--no-merges", f"--author={email}", f"--since=@{since // 1000}", "--format=%H %ct"], repo)
    listed = [line.split() for line in log.splitlines() if line.count(" ") == 1]
    missing = [h for h, _ in listed if h not in known]
    new = {}
    for i in range(0, len(missing), BATCH):
        new.update(numstat(run(["git", "show", "--no-walk", "--format=%x00%H", "--numstat", *missing[i:i + BATCH]], repo)))
    kept = {h: c for h, _ in listed if (c := known.get(h) or new.get(h))}
    commits = [{"t": int(t) * 1000, "repo": repo, "add": kept[h][0], "del": kept[h][1]} for h, t in listed if h in kept]
    return commits, kept


def ms(iso):
    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000) if iso else None


def repo_facts(repo, since, known):
    email = run(["git", "config", "user.email"], repo).strip()
    commits, kept = commit_counts(repo, email, since, known) if email else ([], {})
    # Pull requests on GitHub (gh), merge requests on GitLab (glab): the likelier by the origin remote first, else the
    # other (a GitHub Enterprise host or ssh alias needn't say "github"). GitLab's list carries no line counts.
    prs = []
    remote = run(["git", "remote", "get-url", "origin"], repo)
    tools = [["gh", "pr", "list", "--author", "@me", "--state", "all", "--limit", "300",
              "--json", "number,createdAt,mergedAt,state,additions,deletions"],
             ["glab", "mr", "list", "--author=@me", "--all", "--per-page", "100", "--output", "json"]]
    if "github" not in remote.lower():
        tools.reverse()
    raw = (run(tools[0], repo) or run(tools[1], repo)) if remote else ""
    rows = [(p.get("number", p.get("iid")), p.get("createdAt") or p.get("created_at"), p.get("mergedAt") or p.get("merged_at"),
             p.get("state", ""), p.get("additions", 0), p.get("deletions", 0))
            for p in (json.loads(raw) if raw.strip().startswith("[") else [])]
    for n, created, merged, state, add, dele in rows:
        created = ms(created)
        if created and created >= since:
            state = {"opened": "open"}.get(state.lower(), state.lower())
            prs.append({"repo": repo, "n": n, "created": created, "merged": ms(merged), "add": add, "del": dele, "state": state})
    trees = run(["git", "worktree", "list", "--porcelain"], repo).count("\nworktree ") + (1 if run(["git", "rev-parse", "--git-dir"], repo) else 0)
    return commits, prs, {"repo": repo, "n": trees}, kept


def main():
    since, repos = int(sys.argv[1]), sorted(set(sys.argv[2:]))
    path = counts_path()
    known = load_counts(path)
    out, counts = {"commits": [], "prs": [], "worktrees": []}, {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        for commits, prs, trees, kept in pool.map(lambda r: repo_facts(r, since, known), repos):
            out["commits"] += commits
            out["prs"] += prs
            if trees["n"]:
                out["worktrees"].append(trees)
            counts.update(kept)
    save_counts(path, counts)  # only commits still in the window: the file stays about a year's worth
    json.dump(out, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
