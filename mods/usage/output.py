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
import json, re, subprocess, sys
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


def ms(iso):
    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000) if iso else None


def repo_facts(repo, since):
    email = run(["git", "config", "user.email"], repo).strip()
    commits = []
    if email:
        log = run(["git", "log", "--all", "--no-merges", f"--author={email}", f"--since=@{since // 1000}", "--format=%x00%ct", "--numstat"], repo)
        for chunk in log.split("\0")[1:]:
            lines = chunk.strip().splitlines()
            if not lines:
                continue
            add = dele = 0
            for row in lines[1:]:
                parts = row.split("\t")
                if len(parts) >= 3 and parts[0].isdigit() and parts[1].isdigit() and not GENERATED.search(parts[2]):  # binary files show "-"
                    add += int(parts[0]); dele += int(parts[1])
            commits.append({"t": int(lines[0]) * 1000, "repo": repo, "add": add, "del": dele})
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
    return commits, prs, {"repo": repo, "n": trees}


def main():
    since, repos = int(sys.argv[1]), sorted(set(sys.argv[2:]))
    out = {"commits": [], "prs": [], "worktrees": []}
    with ThreadPoolExecutor(max_workers=8) as pool:
        for commits, prs, trees in pool.map(lambda r: repo_facts(r, since), repos):
            out["commits"] += commits
            out["prs"] += prs
            if trees["n"]:
                out["worktrees"].append(trees)
    json.dump(out, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
