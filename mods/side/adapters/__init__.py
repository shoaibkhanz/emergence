"""One module per harness. Each exposes NAME, caps() -> dict, locate(req, env) -> dict, copy(req, env) -> dict;
answers carry no "v" (side.handle adds it) and report failures as {"error": {code, message}}."""
from . import claude, opencode

ADAPTERS = {"claude": claude, "opencode": opencode}
