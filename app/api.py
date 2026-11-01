from __future__ import annotations

import json
import mimetypes
import os
import pathlib
import re
import secrets
import subprocess
import threading
import time
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from . import config, engines, java_manager
from .jobs import JobManager
from .modrinth import Modrinth
from .server import ServerManager
from .store import Store, now_iso
from .tunnel import TunnelManager
from .util import (
    AppError, http_json,
)

MAX_JSON_BODY = 2 * 1024 * 1024
MAX_UPLOAD = 600 * 1024 * 1024

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
}


class AppContext:
    def __init__(self, store: Store, jobs: JobManager, modrinth: Modrinth,
                 servers: ServerManager) -> None:
        self.store = store
        self.jobs = jobs
        self.modrinth = modrinth
        self.servers = servers
        self.httpd: ThreadingHTTPServer | None = None
        self._started_at = time.time()
        self._version_cache: tuple[float, list[dict[str, Any]]] | None = None
        self._shutdown_lock = threading.Lock()
        self._shutdown_started = False

    def request_shutdown(self) -> None:
        with self._shutdown_lock:
            if self._shutdown_started:
                return
            self._shutdown_started = True

        def stop() -> None:
            time.sleep(0.4)
            try:
                self.servers.shutdown_all()
            finally:
                if self.httpd:
                    self.httpd.shutdown()

        threading.Thread(target=stop, name="app-shutdown", daemon=True).start()

    def game_versions(self) -> list[dict[str, Any]]:
        now = time.time()
        if self._version_cache and now - self._version_cache[0] < 300:
            return self._version_cache[1]
        try:
            versions = self.modrinth.game_versions()
        except Exception:
            try:
                manifest = http_json("https://launchermeta.mojang.com/mc/game/version_manifest_v2.json")
                versions = [
                    {"id": v["id"], "type": v["type"], "major": False}
                    for v in manifest.get("versions", [])[:120]
                ]
            except Exception:
                versions = []
        if not versions:
            versions = [{"id": "26.3", "type": "release", "major": False}]
        self._version_cache = (now, versions)
        return versions


class ApiHandler(BaseHTTPRequestHandler):
    server_version = f"CraftDeck/{config.APP_VERSION}"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        if os.environ.get("CRAFTDECK_DEBUG"):
            super().log_message(fmt, *args)

    def do_GET(self) -> None:
        self._handle("GET")

    def do_POST(self) -> None:
        self._handle("POST")

    def do_PUT(self) -> None:
        self._handle("PUT")

    def do_PATCH(self) -> None:
        self._handle("PATCH")

    def do_DELETE(self) -> None:
        self._handle("DELETE")

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Allow", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _handle(self, method: str) -> None:
        ctx: AppContext = self.server.ctx
        parsed = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(parsed.path)
        try:
            if path.startswith("/api/"):
                query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
                result = self._dispatch(ctx, method, path, query)
                if isinstance(result, tuple) and len(result) == 2 and isinstance(result[1], int):
                    self._json(result[0], status=result[1])
                elif result is not None:
                    self._json(result)
            elif path == "/healthz":
                self._json({"ok": True, "app": config.APP_NAME, "version": config.APP_VERSION})
            else:
                self._serve_static(path)
        except AppError as exc:
            self._json({"error": exc.message, "detail": exc.detail}, status=exc.status)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except Exception as exc:
            traceback.print_exc()
            self._json({"error": "Beklenmeyen bir hata oluştu", "detail": str(exc)}, status=500)

    def _dispatch(self, ctx: AppContext, method: str, path: str, query: dict[str, list[str]]) -> Any:
        parts = [part for part in path.split("/") if part]
        if not parts or parts[0] != "api":
            raise AppError("Bulunamadı", status=404)
        rest = parts[1:]

        if rest == ["bootstrap"] and method == "GET":
            return self._bootstrap(ctx)
        if rest == ["meta"] and method == "GET":
            try:
                tags = ctx.modrinth.tags()
                modrinth_loaders = tags.get("loaders", [])
            except Exception:
                modrinth_loaders = []
            return {
                "game_versions": ctx.game_versions(),
                "loaders": config.LOADERS,
                "modrinth_loaders": modrinth_loaders,
                "platform": java_manager.platform_label(),
                "data_dir": str(config.DATA_DIR),
                "default_jvm_flags": config.DEFAULT_JVM_FLAGS,
            }
        if rest == ["app", "shutdown"] and method == "POST":
            ctx.request_shutdown()
            return {"ok": True, "message": "CraftDeck kapatılıyor"}
        if rest == ["app", "open-data"] and method == "POST":
            self._open_path(config.DATA_DIR)
            return {"ok": True}
        if rest == ["health"] and method == "GET":
            return {"ok": True, "uptime": int(time.time() - ctx._started_at)}

        if rest and rest[0] == "jobs":
            if len(rest) == 1 and method == "GET":
                return {"jobs": ctx.jobs.list()}
            if len(rest) == 2 and method == "GET":
                job = ctx.jobs.get(rest[1])
                if not job:
                    raise AppError("İş bulunamadı", status=404)
                since = int(self._q(query, "since", "0") or 0)
                snapshot = job.snapshot(logs=True)
                snapshot["logs"] = snapshot["logs"][since:]
                return snapshot
            if len(rest) == 3 and rest[2] == "cancel" and method == "POST":
                job = ctx.jobs.get(rest[1])
                if not job:
                    raise AppError("İş bulunamadı", status=404)
                job.cancel()
                return {"ok": True}
        if rest and rest[0] == "jobs" and method == "GET":
            return {"jobs": ctx.jobs.list()}

        if rest and rest[0] == "modrinth":
            return self._modrinth(ctx, method, rest[1:], query)

        if rest == ["java"] and method == "GET":
            runtimes = java_manager.detect(ctx.store)
            return {
                "runtimes": runtimes,
                "platform": java_manager.platform_label(),
                "os": java_manager.adoptium_os(),
                "arch": config.ARCH,
            }
        if rest == ["java", "install"] and method == "POST":
            body = self._body_json()
            major = int(body.get("major") or 21)
            server_id = str(body.get("server_id") or "")
            job = ctx.jobs.create(f"Java {major} indiriliyor", "java")
            target_server = server_id

            def work(job) -> None:
                info = java_manager.install(
                    ctx.store, major,
                    progress=lambda done, total: job.set_progress(
                        min(92, done / total * 92) if total else 50,
                        f"{done // (1024 * 1024)} MB / {total // (1024 * 1024)} MB",
                    ),
                    log=job.log,
                )
                if target_server:
                    try:
                        ctx.store.update_server(target_server, java_path=info["path"])
                        job.log(f"Sunucu Java yolu güncellendi: {info['path']}")
                    except KeyError:
                        pass
                job.set_progress(100, f"Java {info['major']} hazır")

            ctx.jobs.run(job, work)
            return {"job": job.snapshot(logs=False)}
        if rest == ["java", "validate"] and method == "POST":
            body = self._body_json()
            path = str(body.get("path") or "").strip()
            if not path:
                raise AppError("Java yolu boş")
            info = java_manager.probe(path)
            if not info:
                raise AppError("Bu yolda çalışan bir Java bulunamadı", detail=path)
            return {"ok": True, "java": info}

        if rest and rest[0] == "servers":
            return self._servers(ctx, method, rest[1:], query)

        raise AppError("Bulunamadı", status=404)

    def _servers(self, ctx: AppContext, method: str, rest: list[str], query: dict[str, list[str]]) -> Any:
        if not rest:
            if method == "GET":
                return {"servers": ctx.servers.list_servers()}
            if method == "POST":
                body = self._body_json()
                name = str(body.get("name") or "Yeni Sunucu")[:48]
                mc_version = str(body.get("mc_version") or "").strip()
                loader = str(body.get("loader") or "paper").strip()
                if not mc_version:
                    raise AppError("Minecraft sürümü seçilmedi")
                state = ctx.servers.create_server(
                    name, mc_version, loader,
                    port=int(body["port"]) if body.get("port") else None,
                    ram_min_mb=int(body.get("ram_min_mb") or 1024),
                    ram_max_mb=int(body.get("ram_max_mb") or 4096),
                    java_path=str(body.get("java_path") or ""),
                )
                runtime = ctx.servers.runtime(state["id"])
                job_snapshot = None
                if body.get("install", True):
                    job = ctx.jobs.create(f"{name}: motor kurulumu", f"{state['id']}:engine")
                    ctx.jobs.run(job, lambda j: runtime.install_engine(j))
                    job_snapshot = job.snapshot(logs=False)
                return {"server": runtime.state(), "job": job_snapshot}
            raise AppError("Yöntem desteklenmiyor", status=405)

        if rest[0] in {"from-modrinth", "from-mrpack"} and method == "POST":
            return self._create_special(ctx, rest[0])

        server_id = rest[0]
        runtime = ctx.servers.runtime(server_id)
        segments = rest[1:]

        if not segments:
            if method == "GET":
                return self._server_detail(ctx, runtime)
            if method == "PATCH":
                body = self._body_json()
                return self._update_server(ctx, runtime, body)
            if method == "DELETE":
                delete_files = self._q(query, "files", "0") in {"1", "true", "yes"}
                ctx.store.set_last_server("")
                runtime.delete(delete_files=delete_files)
                return {"ok": True}
            raise AppError("Yöntem desteklenmiyor", status=405)

        action = segments[0]

        if action == "start" and method == "POST":
            return runtime.start()
        if action == "stop" and method == "POST":
            return runtime.stop(wait=False)
        if action == "restart" and method == "POST":
            state = runtime.state()
            if state["running"] or state["status"] in {"starting", "stopping"}:
                threading.Thread(target=runtime.restart, daemon=True, name=f"restart-{server_id}").start()
                return {"ok": True, "message": "Yeniden başlatılıyor"}
            return runtime.start()
        if action == "kill" and method == "POST":
            return runtime.kill()
        if action == "command" and method == "POST":
            body = self._body_json()
            return runtime.send(str(body.get("command") or ""))
        if action == "console" and method == "GET":
            since = int(self._q(query, "since", "0") or 0)
            limit = int(self._q(query, "limit", "1500") or 1500)
            return runtime.logs_since(since, limit)
        if action == "console.txt" and method == "GET":
            lines = int(self._q(query, "lines", "2000") or 2000)
            data = runtime.console_text(lines).encode("utf-8", "replace")
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Disposition", f'attachment; filename="{server_id}-console.txt"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return None
        if action == "properties":
            if method == "GET":
                return runtime.get_properties()
            if method in {"PUT", "POST"}:
                body = self._body_json()
                values = body.get("values") if isinstance(body.get("values"), dict) else body
                return runtime.update_properties(values)
        if action == "engine":
            if method == "GET":
                info = engines.read_engine_info(runtime.dir)
                return {"installed": bool(info), "engine": info,
                        "java_required": java_manager.recommended_major(runtime.cfg["mc_version"])}
            if len(segments) > 1 and segments[1] == "install" and method == "POST":
                job = ctx.jobs.create(f"{runtime.name}: motor kurulumu", f"{server_id}:engine")
                ctx.jobs.run(job, lambda j: runtime.install_engine(j))
                return {"job": job.snapshot(logs=False)}
        if action == "content":
            if method == "GET":
                return runtime.list_content()
            if method == "POST":
                body = self._body_json()
                project_id = str(body.get("project_id") or "")
                if not project_id:
                    raise AppError("Proje seçilmedi")
                version_id = str(body.get("version_id") or "") or None
                with_deps = bool(body.get("with_dependencies", True))
                job = ctx.jobs.create(f"{runtime.name}: içerik kurulumu", f"{server_id}:content")
                ctx.jobs.run(job, lambda j: runtime.install_project(
                    project_id, version_id, with_dependencies=with_deps, job=j))
                return {"job": job.snapshot(logs=False)}
            if method == "DELETE":
                target = self._q(query, "path", "")
                if not target:
                    raise AppError("Silinecek dosya belirtilmedi")
                return runtime.delete_content(target)
        if action == "modpack" and method == "POST":
            if len(segments) > 1 and segments[1] == "upload":
                upload = self._receive_upload()
                path = upload["path"]
                if not path.name.lower().endswith(".mrpack"):
                    path.unlink(missing_ok=True)
                    raise AppError("Lütfen .mrpack uzantılı bir dosya seçin")

                def install_upload(job) -> None:
                    try:
                        runtime.install_mrpack(path, job=job)
                    finally:
                        path.unlink(missing_ok=True)

                job = ctx.jobs.create(f"{runtime.name}: modpack kurulumu", f"{server_id}:modpack")
                ctx.jobs.run(job, install_upload)
                return {"job": job.snapshot(logs=False), "filename": upload["filename"]}
            body = self._body_json()
            project_id = str(body.get("project_id") or "")
            if not project_id:
                raise AppError("Modpack projesi belirtilmedi")
            version_id = str(body.get("version_id") or "") or None
            job = ctx.jobs.create(f"{runtime.name}: modpack kurulumu", f"{server_id}:modpack")
            ctx.jobs.run(job, lambda j: runtime.install_modpack_project(project_id, version_id, job=j))
            return {"job": job.snapshot(logs=False)}
        if action == "tunnel":
            return self._tunnel(ctx, runtime, method, segments[1:], query)
        if action == "players" and method == "POST":
            body = self._body_json()
            return runtime.player_action(str(body.get("action") or ""), str(body.get("player") or ""))
        if action == "open" and method == "POST":
            body = self._body_json()
            which = str(body.get("which") or "server")
            targets = {
                "server": runtime.dir,
                "mods": runtime.dir / "mods",
                "logs": runtime.dir / "logs",
                "config": runtime.dir / "config",
                "properties": runtime.dir / "server.properties",
                "data": config.DATA_DIR,
            }
            target = targets.get(which)
            if target is None:
                raise AppError("Açılacak klasör bilinmiyor")
            if not pathlib.Path(target).exists():
                pathlib.Path(target).mkdir(parents=True, exist_ok=True)
            self._open_path(pathlib.Path(target))
            return {"ok": True}
        raise AppError("Bulunamadı", status=404)

    def _server_detail(self, ctx: AppContext, runtime) -> dict[str, Any]:
        ctx.store.set_last_server(runtime.id)
        config_data = runtime.cfg
        return {
            "server": {**config_data, **runtime.state()},
            "config": {
                "extra_jvm_args": config_data.get("extra_jvm_args", ""),
                "tunnel": config_data.get("tunnel", {}),
                "created_at": config_data.get("created_at"),
                "updated_at": config_data.get("updated_at"),
                "java_required": java_manager.recommended_major(config_data.get("mc_version", "")),
            },
            "properties": runtime.get_properties(),
            "content": runtime.list_content(),
            "tunnel": runtime.tunnel.snapshot(since=0),
            "java": java_manager.detect(ctx.store),
        }

    def _update_server(self, ctx: AppContext, runtime, body: dict[str, Any]) -> dict[str, Any]:
        updates: dict[str, Any] = {}
        if "name" in body:
            name = str(body["name"]).strip()[:48]
            if not name:
                raise AppError("Sunucu adı boş olamaz")
            updates["name"] = name
        if "port" in body:
            try:
                port = int(body["port"])
            except (TypeError, ValueError) as exc:
                raise AppError("Geçersiz port") from exc
            if not 1 <= port <= 65535:
                raise AppError("Port 1-65535 arasında olmalı")
            updates["port"] = port
        if "ram_min_mb" in body or "ram_max_mb" in body:
            current = runtime.cfg
            ram_min = int(body.get("ram_min_mb", current.get("ram_min_mb", 1024)))
            ram_max = int(body.get("ram_max_mb", current.get("ram_max_mb", 4096)))
            if ram_min < 256 or ram_max > 65536:
                raise AppError("RAM 256 MB - 64 GB arasında olmalı")
            if ram_max < ram_min:
                raise AppError("Maksimum RAM, minimum RAM'den küçük olamaz")
            updates["ram_min_mb"] = ram_min
            updates["ram_max_mb"] = ram_max
        if "java_path" in body:
            path = str(body["java_path"] or "").strip()
            if path:
                info = java_manager.probe(path)
                if not info:
                    raise AppError("Seçilen Java çalıştırılamadı", detail=path)
            updates["java_path"] = path
        if "extra_jvm_args" in body:
            updates["extra_jvm_args"] = str(body["extra_jvm_args"] or "")[:600]
        if "auto_restart" in body:
            updates["auto_restart"] = bool(body["auto_restart"])
        if "tunnel" in body and isinstance(body["tunnel"], dict):
            tunnel = dict(runtime.cfg.get("tunnel") or {})
            incoming = body["tunnel"]
            for key in ("provider", "ngrok_token", "playit_secret", "manual_address", "custom_command"):
                if key in incoming:
                    tunnel[key] = str(incoming[key] or "")
            updates["tunnel"] = tunnel
        if not updates:
            raise AppError("Güncellenecek alan yok")
        ctx.store.update_server(runtime.id, **updates)
        if "port" in updates:
            runtime.update_properties({"server-port": updates["port"]})
        if "name" in updates:
            runtime.log(f"Sunucu adı güncellendi: {updates['name']}", "system")
        return {**runtime.state(), "restart_required": runtime.running}

    def _create_special(self, ctx: AppContext, kind: str) -> Any:
        if kind == "from-modrinth":
            body = self._body_json()
            project_id = str(body.get("project_id") or "")
            if not project_id:
                raise AppError("Modpack seçilmedi")
            project = ctx.modrinth.project(project_id)
            if project.get("type") != "modpack":
                raise AppError("Bu proje bir modpack değil")
            version_id = str(body.get("version_id") or "") or None
            if version_id:
                version = ctx.modrinth.version(version_id)
            else:
                available = ctx.modrinth.versions(project_id)
                if not available:
                    raise AppError(
                        "Bu modpack için indirilebilir sürüm yok",
                        detail="Modrinth'te yayınlanmış bir sürüm bulunamadı. Paketin sayfasını kontrol edin.",
                    )
                version = available[0]
            loaders = [l for l in version.get("loaders", []) if l in {"fabric", "quilt", "forge", "neoforge"}]
            loader = loaders[0] if loaders else "vanilla"
            versions = version.get("game_versions") or []
            mc = self._latest_mc(versions) if versions else ""
            if not mc:
                raise AppError("Modpack Minecraft sürümü belirtmiyor")
            name = str(body.get("name") or project.get("title") or "Modpack")[:48]
            state = ctx.servers.create_server(
                name, mc, loader,
                port=int(body["port"]) if body.get("port") else None,
                ram_max_mb=int(body.get("ram_max_mb") or 4096),
            )
            runtime = ctx.servers.runtime(state["id"])
            job = ctx.jobs.create(f"{name}: modpack kurulumu", f"{state['id']}:modpack")
            ctx.jobs.run(job, lambda j: runtime.install_modpack_project(project["id"], version["id"], job=j))
            return {"server": runtime.state(), "job": job.snapshot(logs=False)}

        upload = self._receive_upload()
        path: pathlib.Path = upload["path"]
        if not path.name.lower().endswith(".mrpack"):
            path.unlink(missing_ok=True)
            raise AppError("Lütfen .mrpack uzantılı bir dosya seçin")
        from .mrpack import read_mrpack

        try:
            pack = read_mrpack(path)
        except Exception:
            path.unlink(missing_ok=True)
            raise

        def install_upload(job) -> None:
            try:
                runtime.install_mrpack(path, job=job)
            finally:
                path.unlink(missing_ok=True)

        name = pack["name"][:48]
        state = ctx.servers.create_server(
            name, pack["mc_version"], pack["loader"],
            port=None, ram_max_mb=4096,
        )
        runtime = ctx.servers.runtime(state["id"])
        job = ctx.jobs.create(f"{name}: modpack kurulumu", f"{state['id']}:modpack")
        ctx.jobs.run(job, install_upload)
        return {"server": runtime.state(), "job": job.snapshot(logs=False), "pack": {
            "name": pack["name"], "mc_version": pack["mc_version"], "loader": pack["loader"],
            "file_count": pack["file_count"], "override_count": pack["override_count"],
        }}

    def _tunnel(self, ctx: AppContext, runtime, method: str, segments: list[str],
                query: dict[str, list[str]]) -> Any:
        if method == "GET":
            cfg = runtime.cfg
            tunnel_cfg = cfg.get("tunnel") or {}
            return {
                **runtime.tunnel.snapshot(since=int(self._q(query, "since", "0") or 0)),
                "configured_provider": tunnel_cfg.get("provider", ""),
                "manual_address": tunnel_cfg.get("manual_address", ""),
                "ngrok_token": tunnel_cfg.get("ngrok_token", ""),
                "playit_secret": tunnel_cfg.get("playit_secret", ""),
                "custom_command": tunnel_cfg.get("custom_command", ""),
                "port": runtime.get_port(),
                "example": f"ornek-adres.joinmc.link:{runtime.get_port()}",
            }
        if method != "POST":
            raise AppError("Yöntem desteklenmiyor", status=405)
        action = segments[0] if segments else ""
        if action == "start":
            body = self._body_json()
            provider = str(body.get("provider") or "ngrok")
            token = str(body.get("token") or "")
            command = str(body.get("command") or "")
            tunnel_cfg = dict(runtime.cfg.get("tunnel") or {})
            tunnel_cfg["provider"] = provider
            if provider == "ngrok":
                tunnel_cfg["ngrok_token"] = token
            elif provider == "playit":
                tunnel_cfg["playit_secret"] = token
            elif provider == "custom":
                tunnel_cfg["custom_command"] = command
            ctx.store.update_server(runtime.id, tunnel=tunnel_cfg)
            return runtime.tunnel.start(provider, token, command)
        if action == "stop":
            return runtime.tunnel.stop()
        if action == "reset":
            tunnel_cfg = dict(runtime.cfg.get("tunnel") or {})
            tunnel_cfg["manual_address"] = ""
            tunnel_cfg["auto_address"] = ""
            ctx.store.update_server(runtime.id, tunnel=tunnel_cfg)
            return runtime.tunnel.reset()
        if action == "address":
            body = self._body_json()
            address = str(body.get("address") or "").strip()
            if len(address) > 200:
                raise AppError("Adres çok uzun")
            tunnel_cfg = dict(runtime.cfg.get("tunnel") or {})
            tunnel_cfg["manual_address"] = address
            ctx.store.update_server(runtime.id, tunnel=tunnel_cfg)
            if address:
                runtime.tunnel.set_address(address)
            return {"ok": True, "address": address}
        raise AppError("Bulunamadı", status=404)

    def _modrinth(self, ctx: AppContext, method: str, rest: list[str], query: dict[str, list[str]]) -> Any:
        if not rest:
            raise AppError("Bulunamadı", status=404)
        if rest[0] == "search" and method == "GET":
            return ctx.modrinth.search(
                self._q(query, "query", ""),
                project_type=self._q(query, "type", ""),
                loader=self._q(query, "loader", ""),
                game_version=self._q(query, "version", ""),
                index=self._q(query, "index", "relevance"),
                offset=int(self._q(query, "offset", "0") or 0),
                limit=int(self._q(query, "limit", "24") or 24),
            )
        if rest[0] == "project" and len(rest) >= 2 and method == "GET":
            project = ctx.modrinth.project(rest[1])
            try:
                project["versions_all"] = ctx.modrinth.versions(rest[1])
            except Exception:
                project["versions_all"] = []
            return project
        if rest[0] == "versions" and method == "GET":
            project_id = self._q(query, "project_id", "")
            if not project_id:
                raise AppError("project_id gerekli")
            versions = ctx.modrinth.versions(
                project_id,
                loader=self._q(query, "loader", ""),
                game_version=self._q(query, "version", ""),
            )
            return {"versions": versions}
        if rest[0] == "resolve" and method == "GET":
            project_id = self._q(query, "project_id", "")
            loader = self._q(query, "loader", "")
            game_version = self._q(query, "version", "")
            if not project_id:
                raise AppError("project_id gerekli")
            version = ctx.modrinth.pick_version(project_id, loader=loader, game_version=game_version)
            deps, warnings = ctx.modrinth.resolve_dependencies(version, loader=loader, game_version=game_version)
            return {
                "version": version,
                "dependencies": [
                    {"title": d["project"].get("title"), "type": d["project"].get("type"),
                     "filename": d["file"].get("filename")}
                    for d in deps
                ],
                "warnings": warnings,
            }
        raise AppError("Bulunamadı", status=404)

    def _bootstrap(self, ctx: AppContext) -> dict[str, Any]:
        warnings: list[str] = []
        try:
            java_runtimes = java_manager.detect(ctx.store)
        except Exception as exc:
            java_runtimes = []
            warnings.append(f"Java taraması başarısız: {exc}")
        settings = ctx.store.get_settings()
        return {
            "app": {
                "name": config.APP_NAME,
                "version": config.APP_VERSION,
                "tagline": config.APP_TAGLINE,
                "platform": java_manager.platform_label(),
                "data_dir": str(config.DATA_DIR),
                "started_at": int(ctx._started_at),
            },
            "servers": ctx.servers.list_servers(),
            "last_server": settings.get("last_server", ""),
            "java": {
                "runtimes": java_runtimes,
                "platform": java_manager.platform_label(),
                "os": java_manager.adoptium_os(),
                "arch": config.ARCH,
                "recommended": 25,
            },
            "game_versions": ctx.game_versions(),
            "loaders": config.LOADERS,
            "jobs": ctx.jobs.list(),
            "warnings": warnings,
        }

    def _body_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return {}
        if length > MAX_JSON_BODY:
            raise AppError("İstek gövdesi çok büyük", status=413)
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise AppError("Geçersiz JSON gövdesi", detail=str(exc)) from exc
        return data if isinstance(data, dict) else {}

    def _q(self, query: dict[str, list[str]], key: str, default: str = "") -> str:
        values = query.get(key)
        return values[0] if values else default

    def _receive_upload(self) -> dict[str, Any]:
        ctype = self.headers.get("Content-Type", "")
        match = re.search(r'boundary=(?:"([^"]+)"|([^;]+))', ctype)
        if not match:
            raise AppError("Dosya yüklemesi multipart/form-data olmalı")
        boundary = (match.group(1) or match.group(2) or "").strip().encode("latin-1")
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            raise AppError("Dosya gönderilmedi")
        if length > MAX_UPLOAD:
            raise AppError("Dosya çok büyük (en fazla 600 MB)", status=413)

        dash = b"--" + boundary
        rfile = self.rfile
        consumed = 0
        line = rfile.readline(8192)
        consumed += len(line)
        guard = 0
        while line and not line.startswith(dash):
            line = rfile.readline(8192)
            consumed += len(line)
            guard += 1
            if guard > 1000:
                raise AppError("Multipart başlığı okunamadı")
        if not line:
            raise AppError("Multipart gövdesi boş")

        headers: dict[str, str] = {}
        while True:
            line = rfile.readline(8192)
            consumed += len(line)
            if line in (b"\r\n", b"\n", b""):
                break
            text = line.decode("latin-1")
            if ":" in text:
                key, _, value = text.partition(":")
                headers[key.strip().lower()] = value.strip()
        disposition = headers.get("content-disposition", "")
        file_match = re.search(r'filename="([^"]*)"', disposition) or re.search(r"filename=([^;]+)", disposition)
        if not file_match:
            raise AppError("Gönderilen formda dosya alanı yok")
        original = pathlib.Path(file_match.group(1).replace("\\", "/")).name
        if not original:
            raise AppError("Dosya adı geçersiz")

        config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        target = config.UPLOAD_DIR / f"upload-{secrets.token_hex(6)}-{original}"
        delimiter = b"\r\n" + dash
        pending = b""
        total = 0
        remaining = max(0, length - consumed)
        self.close_connection = True
        self.connection.settimeout(120)
        try:
            with open(target, "wb") as out:
                while total < remaining:
                    chunk = rfile.read(min(256 * 1024, remaining - total))
                    if not chunk:
                        break
                    total += len(chunk)
                    pending += chunk
                    index = pending.find(delimiter)
                    if index >= 0:
                        out.write(pending[:index])
                        break
                    keep = len(delimiter) + 4
                    if len(pending) > keep:
                        out.write(pending[:-keep])
                        pending = pending[-keep:]
                else:
                    out.write(pending)
        except Exception:
            target.unlink(missing_ok=True)
            raise
        if target.stat().st_size == 0:
            target.unlink(missing_ok=True)
            raise AppError("Yüklenen dosya boş")
        return {"path": target, "filename": original, "size": target.stat().st_size}

    def _serve_static(self, path: str) -> None:
        if path in {"", "/"}:
            path = "/index.html"
        relative = path.lstrip("/")
        if ".." in relative.split("/") or relative.startswith("."):
            raise AppError("Bulunamadı", status=404)
        target = (config.WEB_DIR / relative).resolve()
        try:
            target.relative_to(config.WEB_DIR.resolve())
        except ValueError as exc:
            raise AppError("Bulunamadı", status=404) from exc
        if not target.is_file():
            if "." not in relative:
                target = config.WEB_DIR / "index.html"
            else:
                raise AppError("Bulunamadı", status=404)
        data = target.read_bytes()
        ext = target.suffix.lower()
        self.send_response(200)
        self.send_header("Content-Type", CONTENT_TYPES.get(ext, mimetypes.guess_type(str(target))[0] or "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def _json(self, data: Any, *, status: int = 200) -> None:
        raw = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _open_path(self, target: pathlib.Path) -> None:
        target = pathlib.Path(target)
        try:
            if config.IS_WINDOWS:
                os.startfile(str(target))
            elif config.IS_MAC:
                subprocess.Popen(["open", str(target)])
            else:
                subprocess.Popen(["xdg-open", str(target)])
        except Exception as exc:
            raise AppError("Klasör açılamadı", detail=str(exc)) from exc

    def _latest_mc(self, versions: list[str]) -> str:
        def key(value: str):
            return tuple(int(p) if p.isdigit() else -1 for p in re.split(r"[.\-+]", value))

        releases = [v for v in versions if not re.search(r"(snapshot|pre|rc)", v, re.IGNORECASE)]
        pool = releases or versions
        try:
            return max(pool, key=key)
        except ValueError:
            return pool[0] if pool else ""


class ApiServer(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address) -> None:
        import sys

        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


def make_server(host: str, port: int, ctx: AppContext) -> ThreadingHTTPServer:
    server = ApiServer((host, port), ApiHandler)
    server.ctx = ctx
    return server
