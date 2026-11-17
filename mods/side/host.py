"""A side chat slot's terminal (side-N): it never ends, and runs one side chat after another.

Herdr deletes a layout block from the layout file when the terminal it shows ends, and emergence.json is the repo's,
so a slot's terminal must outlive every side chat in it. The mod hands this host a chat by writing a request file and
ends one by writing a stop file; the host runs the agent in this terminal and goes back to waiting.

  python3 -B host.py serve <slot> <dir>           the slot terminal's program
  python3 -B host.py send <slot> <dir> '<json>'   {"argv": [...], "cwd": "...", "intro": "..."}: start that chat
  python3 -B host.py stop <slot> <dir>            end the slot's chat (not the slot)
"""
from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time

STALE_S = 30  # a request older than this was never picked up: dropped, never started late
OPENING = "\n  Opening a side chat…\n"  # an idle slot is only seen at a key press, before its chat starts
CLEAR = "\033[2J\033[H"


def paths(slot: str, d: str) -> tuple[str, str]:
    return os.path.join(d, f"{slot}.json"), os.path.join(d, f"{slot}.stop")


def send(slot: str, d: str, req: dict) -> None:
    os.makedirs(d, exist_ok=True)
    path, _ = paths(slot, d)
    with open(path + ".tmp", "w") as f:
        json.dump(req, f)
    os.replace(path + ".tmp", path)  # the host never reads half a request


def stop(slot: str, d: str) -> None:
    os.makedirs(d, exist_ok=True)
    open(paths(slot, d)[1], "w").close()


def take(path: str) -> dict | None:
    try:
        stale = time.time() - os.path.getmtime(path) > STALE_S
        with open(path) as f:
            req = None if stale else json.load(f)
    except FileNotFoundError:
        return None
    except ValueError:
        req = None  # corrupt: drop it
    os.remove(path)
    return req if isinstance(req, dict) and req.get("argv") else None


def run(req: dict, stop_path: str, poll: float = 0.2) -> int:
    """Run the chat in this terminal until it exits, or until a stop file appears. Its intro line goes first."""
    if req.get("intro"):
        print(f"{req['intro']}\n", flush=True)
    child = subprocess.Popen(req["argv"], cwd=req.get("cwd") or None,
                             preexec_fn=lambda: signal.signal(signal.SIGINT, signal.SIG_DFL))
    while child.poll() is None:
        if os.path.exists(stop_path):
            os.remove(stop_path)
            child.terminate()
            try:
                child.wait(3)
            except subprocess.TimeoutExpired:
                child.kill()
        time.sleep(poll)
    return child.returncode


def changed(path: str, since: float) -> bool:
    """Whether the file was saved since `since` (a missing file isn't a change: keep running)."""
    try:
        return os.path.getmtime(path) != since
    except OSError:
        return False


def ready(path: str) -> bool:
    """Whether the file is a whole Python program (a half-saved edit isn't: running it would end the host)."""
    try:
        with open(path, encoding="utf-8") as f:
            compile(f.read(), path, "exec")
        return True
    except (OSError, SyntaxError, ValueError):
        return False


FAILED_S = 5  # a chat that ends with an error this soon never really opened: its message stays (failed_at_once)


def failed_at_once(code: int, took: float) -> bool:
    """Whether a chat ended with an error before it ever really opened (a flag its harness refused, a missing
    program): then its message stays on screen instead of being cleared for the next one."""
    return code != 0 and took < FAILED_S


def mark_argv(slot: str, on: bool) -> list:
    return ["hc", "label", slot, f"side.chat={'on' if on else ''}"]  # `key=` removes the label


def mark(slot: str, on: bool) -> None:
    """Label the slot side.chat=on while a chat runs: the mod's only sign of one, because Herdr keeps an ended agent's
    report (omp's "idle") on the terminal. A failed label is printed, never raised: the slot must never end."""
    try:
        r = subprocess.run(mark_argv(slot, on), capture_output=True, text=True, timeout=5)
        if r.returncode != 0:
            print(f"side host: hc label: {(r.stderr or r.stdout).strip()}", flush=True)
    except (OSError, subprocess.SubprocessError) as e:
        print(f"side host: hc label: {e}", flush=True)


def idle() -> None:
    print(CLEAR + OPENING, end="", flush=True)


def serve(slot: str, d: str) -> None:
    signal.signal(signal.SIGINT, signal.SIG_IGN)  # ctrl-c belongs to the chat, never to the slot
    os.makedirs(d, exist_ok=True)
    req_path, stop_path = paths(slot, d)
    me = os.path.abspath(__file__)
    since = os.path.getmtime(me)
    mark(slot, False)  # a host restarted mid-chat (killed, or updated) has no chat
    idle()
    while True:
        try:
            if changed(me, since):  # an updated host: restart in place, never ending (the slot's block needs it)
                if ready(me):
                    os.execv(sys.executable, [sys.executable, "-B", me, "serve", slot, d])
                since = os.path.getmtime(me)  # broken: keep running this version, look again at the next save
            req = take(req_path)
            if req:
                if os.path.exists(stop_path):
                    os.remove(stop_path)  # a stop from before this chat
                print(CLEAR, end="", flush=True)
                began = time.time()
                mark(slot, True)
                try:
                    code = run(req, stop_path)
                finally:
                    mark(slot, False)
                if failed_at_once(code, time.time() - began):
                    print(f"\n  This side chat couldn't start (exit {code}); the message above says why.", flush=True)
                else:
                    idle()
            time.sleep(0.25)
        except Exception as e:  # never end: the slot's layout block depends on this terminal
            print(f"side host: {e}", flush=True)
            time.sleep(1)


if __name__ == "__main__":
    op, slot, d = sys.argv[1:4]
    if op == "serve":
        serve(slot, d)
    elif op == "send":
        send(slot, d, json.loads(sys.argv[4]))
    elif op == "stop":
        stop(slot, d)
