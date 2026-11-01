from __future__ import annotations

import datetime as dt
import secrets
import threading
import time
from typing import Any

from . import config
from .util import read_json, write_json


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


class Store:
    def __init__(self, state_file=None) -> None:
        self._path = state_file or config.STATE_FILE
        self._lock = threading.RLock()
        self._state: dict[str, Any] = {"version": 1, "servers": {}, "java_runtimes": [], "settings": {}}
        self.load()

    def load(self) -> None:
        with self._lock:
            data = read_json(self._path, None)
            if isinstance(data, dict):
                self._state.update(data)
            self._state.setdefault("servers", {})
            self._state.setdefault("java_runtimes", [])
            self._state.setdefault("settings", {})
            for sid, srv in list(self._state["servers"].items()):
                if not isinstance(srv, dict) or not srv.get("id"):
                    self._state["servers"].pop(sid, None)

    def save(self) -> None:
        with self._lock:
            write_json(self._path, self._state)

    def list_servers(self) -> list[dict[str, Any]]:
        with self._lock:
            servers = [dict(s) for s in self._state["servers"].values()]
        servers.sort(key=lambda s: s.get("created_at", ""))
        return servers

    def get_server(self, server_id: str) -> dict[str, Any] | None:
        with self._lock:
            srv = self._state["servers"].get(server_id)
            return dict(srv) if srv else None

    def update_server(self, server_id: str, **fields: Any) -> dict[str, Any]:
        with self._lock:
            srv = self._state["servers"].get(server_id)
            if not srv:
                raise KeyError(server_id)
            for key, value in fields.items():
                if value is not None:
                    srv[key] = value
            srv["updated_at"] = now_iso()
            write_json(self._path, self._state)
            return dict(srv)

    def create_server(self, name: str, mc_version: str, loader: str, *, port: int = 25565,
                      ram_min_mb: int = 1024, ram_max_mb: int = 4096,
                      java_path: str = "", loader_version: str = "") -> dict[str, Any]:
        server_id = "srv_" + secrets.token_hex(5)
        tunnel_cfg = {"provider": "none", "ngrok_token": "", "playit_secret": "", "manual_address": ""}
        defaults = self.get_settings().get("tunnel_defaults")
        if isinstance(defaults, dict):
            provider = str(defaults.get("provider") or "")
            if provider in {"ngrok", "playit"}:
                tunnel_cfg["provider"] = provider
            for key in ("ngrok_token", "playit_secret", "manual_address"):
                value = defaults.get(key)
                if isinstance(value, str) and value.strip():
                    tunnel_cfg[key] = value.strip()
        record = {
            "id": server_id,
            "name": name.strip() or "Yeni Sunucu",
            "dir": str(config.server_dir(server_id)),
            "mc_version": mc_version,
            "loader": loader,
            "loader_version": loader_version,
            "engine_version": "",
            "port": int(port),
            "ram_min_mb": int(ram_min_mb),
            "ram_max_mb": int(ram_max_mb),
            "java_path": java_path,
            "extra_jvm_args": "",
            "auto_restart": False,
            "installed": False,
            "mrpack": None,
            "tunnel": tunnel_cfg,
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }
        with self._lock:
            self._state["servers"][server_id] = record
            write_json(self._path, self._state)
        config.server_dir(server_id).mkdir(parents=True, exist_ok=True)
        return dict(record)

    def delete_server(self, server_id: str) -> dict[str, Any] | None:
        with self._lock:
            srv = self._state["servers"].pop(server_id, None)
            write_json(self._path, self._state)
            return srv

    def get_settings(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._state.get("settings", {}))

    def update_settings(self, **fields: Any) -> dict[str, Any]:
        with self._lock:
            settings = self._state.setdefault("settings", {})
            settings.update(fields)
            write_json(self._path, self._state)
            return dict(settings)

    def get_java_runtimes(self) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(r) for r in self._state.get("java_runtimes", [])]

    def add_java_runtime(self, path: str, major: int, version: str = "") -> None:
        with self._lock:
            runtimes = self._state.setdefault("java_runtimes", [])
            runtimes = [r for r in runtimes if r.get("path") != path]
            runtimes.append({"path": path, "major": major, "version": version,
                             "added_at": now_iso(), "source": "auto"})
            self._state["java_runtimes"] = runtimes
            write_json(self._path, self._state)

    def last_server_id(self) -> str | None:
        value = self.get_settings().get("last_server")
        return value if isinstance(value, str) else None

    def set_last_server(self, server_id: str) -> None:
        self.update_settings(last_server=server_id)
