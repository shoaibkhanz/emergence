"""One module per harness. Each exposes NAME, caps() -> dict, locate(req, env) -> dict, copy(req, env) -> dict;
answers carry no "v" (side.handle adds it) and report failures as {"error": {code, message}}. chat.py and
pi_format.py are shared by adapters, not harnesses."""
from . import claude, omp, opencode, pi

ADAPTERS = {"claude": claude, "opencode": opencode, "pi": pi, "omp": omp}
