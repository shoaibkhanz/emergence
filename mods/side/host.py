"""A side chat slot's terminal (side-N): it never ends, and runs one side chat after another.

Herdr deletes a layout block from the layout file when the terminal it shows ends, and emergence.json is the repo's,
so a slot's terminal must outlive every side chat in it. The mod hands this host a chat by writing a request file and
ends one by writing a stop file; the host runs the agent in this terminal and goes back to waiting.

  python3 -B host.py serve <slot> <dir>           the slot terminal's program
  python3 -B host.py send <slot> <dir> '<json>'   {"argv": [...], "cwd": "..."}: start that chat in the slot
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
ENDED = "\n  Side chat ended. Close its tab, or start another with ⌘⌥/ on an agent.\n"


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
    """Run the chat in this terminal until it exits, or until a stop file appears."""
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


def serve(slot: str, d: str) -> None:
    signal.signal(signal.SIGINT, signal.SIG_IGN)  # ctrl-c belongs to the chat, never to the slot
    os.makedirs(d, exist_ok=True)
    req_path, stop_path = paths(slot, d)
    while True:
        try:
            req = take(req_path)
            if req:
                if os.path.exists(stop_path):
                    os.remove(stop_path)  # a stop from before this chat
                print("\033[2J\033[H", end="", flush=True)
                run(req, stop_path)
                print(ENDED, flush=True)
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
