"""What a side chat gets as background, for harnesses that start a fresh session beside the agent rather than copy
its session (Claude Code, pi, omp): the side-chat instruction, the latest compaction summary and the most recent
exchanges, plus the path of a plain-text digest of the whole conversation it can read when asked about something
older. Files, never argv: argv shows in `ps`."""
from __future__ import annotations  # stock macOS python3 is 3.9: `str | None` must not evaluate at import

import os
import shutil
import time

INSTR = "Answer and explain; don't edit files. Files may have changed since this point."
CAP = 24000  # characters of recent exchanges in the background (~6k tokens)
KEEP = 20  # chat folders kept under <dataDir>/chats


def digest(es: list) -> str:
    """Entries [(role, text)] as text: a heading each time the speaker changes."""
    out, last = [], None
    for role, text in es:
        if role != last:
            out.append(f"\n## {'You' if role == 'user' else 'Agent'}\n")
            last = role
        out.append(text)
    return "\n".join(out).strip() + "\n"


def recent(es: list, cap: int = CAP) -> list:
    """The longest tail of entries that starts at something the person said and fits in cap characters. If none
    does (pressed mid-work, or one huge exchange), the longest tail that fits, topped up with the end of the entry
    before it, so the background is never just "[used Bash]"."""
    best, size, j = None, 0, len(es)
    for i in range(len(es) - 1, -1, -1):
        if size + len(es[i][1]) > cap:
            break
        size += len(es[i][1])
        j = i
        if es[i][0] == "user":
            best = i
    if best is not None:
        return es[best:]
    rest = cap - size
    head = [(es[j - 1][0], es[j - 1][1][-rest:])] if j > 0 and rest > 0 else []
    return head + es[j:]


def _write(path: str, text: str) -> None:
    """A private file (0600): the conversation is as private as the harness's own transcripts."""
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w", encoding="utf-8") as f:
        f.write(text)


def write_chat(sid: str, es: list, summary: str | None, data_dir: str) -> str:
    """A chat folder for one side chat -> the path of its background file."""
    chats = os.path.join(data_dir, "chats")
    d = os.path.join(chats, f"{int(time.time() * 1000)}-{sid[:8]}")
    os.makedirs(d, mode=0o700)
    conv = os.path.join(d, "conversation.md")
    _write(conv, digest(es))
    bg = [INSTR, f"You're a side chat beside an agent. Its whole conversation so far is in {conv}; read it in parts "
                 "when asked about something not below.",
          f"## Earlier, summarised\n\n{summary}" if summary else "",
          "## Most recent exchanges\n" + digest(recent(es))]
    path = os.path.join(d, "background.md")
    _write(path, "\n\n".join(b for b in bg if b))
    for old in sorted(os.listdir(chats))[:-KEEP]:
        shutil.rmtree(os.path.join(chats, old), ignore_errors=True)
    return path


def carried(args: list[str], carry: tuple) -> list[str]:
    """The flags in carry (spaced or --flag=value) from a program's argv, so the copy talks to the same model."""
    out, i = [], 1
    while i < len(args):
        a = args[i]
        if a in carry and i + 1 < len(args):
            out += [a, args[i + 1]]
            i += 2
            continue
        if a.split("=", 1)[0] in carry and "=" in a:
            out.append(a)
        i += 1
    return out
