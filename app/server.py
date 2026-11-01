from __future__ import annotations

import datetime as dt
import os
import pathlib
import re
import shlex
import shutil
import subprocess
import threading
import time
from collections import deque
from typing import Any, Callable

from . import config, engines, java_manager, mrpack
from .jobs import Job, JobManager
from .modrinth import Modrinth, is_client_only
from .store import Store, now_iso
from .tunnel import TunnelManager
from .util import (
    AppError, decode_process_text, download_file, free_port, http_json, port_in_use, read_json,
    read_properties, safe_join, terminate_process_tree, update_properties, write_json,
)

JOIN_RE = re.compile(r"(?:^|:\s|>\s)([A-Za-z0-9_]{1,16}) joined the game")
LEAVE_RE = re.compile(r"(?:^|:\s|>\s)([A-Za-z0-9_]{1,16}) left the game")
DONE_RE = re.compile(r"Done \(([\d.,]+)s\)!")

DEFAULT_PROPERTIES = {
    "server-ip": "",
    "server-port": "25565",
    "online-mode": "true",
    "enable-status": "true",
    "prevent-proxy-connections": "false",
    "use-native-transport": "true",
    "network-compression-threshold": "256",
    "rate-limit": "0",
    "level-name": "world",
    "level-seed": "",
    "level-type": "minecraft:normal",
    "generator-settings": "{}",
    "generate-structures": "true",
    "allow-nether": "true",
    "spawn-protection": "16",
    "max-world-size": "29999984",
    "hardcore": "false",
    "max-tick-time": "60000",
    "max-chained-neighbor-updates": "1000000",
    "gamemode": "survival",
    "force-gamemode": "false",
    "difficulty": "easy",
    "pvp": "true",
    "max-players": "20",
    "player-idle-timeout": "0",
    "spawn-monsters": "true",
    "spawn-animals": "true",
    "spawn-npcs": "true",
    "allow-flight": "false",
    "hide-online-players": "false",
    "view-distance": "10",
    "simulation-distance": "10",
    "entity-broadcast-range-percentage": "100",
    "white-list": "false",
    "enforce-whitelist": "false",
    "op-permission-level": "4",
    "function-permission-level": "2",
    "enable-command-block": "false",
    "enforce-secure-profile": "true",
    "enable-rcon": "false",
    "rcon.port": "25575",
    "rcon.password": "",
    "broadcast-rcon-to-ops": "true",
    "broadcast-console-to-ops": "true",
    "motd": "A Minecraft Server",
    "resource-pack": "",
    "resource-pack-sha1": "",
    "require-resource-pack": "false",
    "resource-pack-prompt": "",
}

CONTENT_DIRS = {
    "mod": "mods",
    "plugin": "plugins",
    "resourcepack": "resourcepacks",
    "shader": "shaderpacks",
    "datapack": "world/datapacks",
}

MOD_SERVER_LOADERS = {"fabric", "quilt", "forge", "neoforge"}
PLUGIN_SERVER_LOADERS = {"paper", "purpur", "spigot", "bukkit", "folia"}

ENGINE_LABELS = {
    "fabric": "Fabric", "quilt": "Quilt", "forge": "Forge", "neoforge": "NeoForge",
    "paper": "Paper", "purpur": "Purpur", "vanilla": "Vanilla",
}


def _split_args(value: str) -> list[str]:
    try:
        return shlex.split(value, posix=not config.IS_WINDOWS)
    except ValueError:
        return value.split()


class ServerRuntime:
    def __init__(self, manager: "ServerManager", record: dict[str, Any]) -> None:
        self.manager = manager
        self.store = manager.store
        self.id = record["id"]
        self.dir = pathlib.Path(record["dir"])
        self.dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._proc: subprocess.Popen | None = None
        self._status = "stopped"
        self._logs: deque[dict[str, Any]] = deque(maxlen=5000)
        self._seq = 0
        self._players: set[str] = set()
        self._started_at = 0.0
        self._stopping = False
        self._error = ""
        self._exit_code: int | None = None
        self._restart_count = 0
        self._last_restart = 0.0
        self._content_index_path = self.dir / ".craftdeck" / "content.json"
        self.tunnel = TunnelManager(self.id, self.get_port, self._persist_address)

    @property
    def cfg(self) -> dict[str, Any]:
        record = self.store.get_server(self.id)
        if not record:
            raise AppError("Sunucu kaydı bulunamadı", status=404)
        return record

    @property
    def name(self) -> str:
        return self.cfg.get("name", "Sunucu")

    @property
    def running(self) -> bool:
        with self._lock:
            return self._proc is not None and self._proc.poll() is None

    def get_port(self) -> int:
        return int(self.cfg.get("port", 25565))

    def log(self, text: str, stream: str = "system") -> None:
        text = str(text)
        if not text:
            return
        with self._lock:
            for line in text.splitlines() or [""]:
                self._seq += 1
                self._logs.append({
                    "seq": self._seq,
                    "t": time.time(),
                    "stream": stream,
                    "text": line,
                })
            if len(self._logs) > 5000:
                del self._logs[: len(self._logs) - 5000]

    def logs_since(self, since: int = 0, limit: int = 2000) -> dict[str, Any]:
        with self._lock:
            lines = [line for line in self._logs if line["seq"] > since]
            if len(lines) > limit:
                lines = lines[-limit:]
            return {"lines": lines, "last_seq": self._seq}

    def console_text(self, max_lines: int = 1000) -> str:
        with self._lock:
            lines = list(self._logs)[-max_lines:]
        return "\n".join(f"[{time.strftime('%H:%M:%S', time.localtime(l['t']))}] {l['text']}" for l in lines)

    def properties_path(self) -> pathlib.Path:
        return self.dir / "server.properties"

    def ensure_server_files(self, *, reset_properties: bool = False) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        eula = self.dir / "eula.txt"
        eula_text = ""
        if eula.exists():
            try:
                eula_text = eula.read_text(encoding="utf-8", errors="replace")
            except OSError:
                eula_text = ""
        if "eula=true" not in eula_text.replace(" ", "").lower():
            eula.write_text(
                "# Minecraft EULA kabul edildi (CraftDeck)\n"
                "# https://aka.ms/MinecraftEULA\n"
                "eula=true\n",
                encoding="utf-8",
            )
            self.log("✔ eula.txt oluşturuldu (eula=true)", "success")

        cfg = self.cfg
        props = self.properties_path()
        if reset_properties or not props.exists():
            defaults = dict(DEFAULT_PROPERTIES)
            defaults["server-port"] = str(cfg.get("port", 25565))
            defaults["motd"] = f"{cfg.get('name', 'CraftDeck')} | CraftDeck"
            update_properties(props, defaults)
            self.log("✔ server.properties oluşturuldu", "success")
        else:
            current = read_properties(props)
            if str(current.get("server-port", "")) != str(cfg.get("port", 25565)):
                update_properties(props, {"server-port": str(cfg.get("port", 25565))})

    def get_properties(self) -> dict[str, Any]:
        self.ensure_server_files()
        props = read_properties(self.properties_path())
        merged = {**DEFAULT_PROPERTIES, **props}
        return {
            "values": merged,
            "path": str(self.properties_path()),
            "defaults": DEFAULT_PROPERTIES,
        }

    def update_properties(self, updates: dict[str, Any]) -> dict[str, Any]:
        clean: dict[str, str] = {}
        for key, value in updates.items():
            key = str(key).strip()
            if not key or not re.match(r"^[A-Za-z0-9._-]{1,64}$", key):
                continue
            clean[key] = "" if value is None else str(value)
        if not clean:
            raise AppError("Geçerli bir ayar gönderilmedi")
        values = update_properties(self.properties_path(), clean)
        if "server-port" in clean:
            try:
                port = int(str(clean["server-port"]))
                if 1 <= port <= 65535:
                    self.store.update_server(self.id, port=port)
            except ValueError:
                pass
        self.log(f"⚙ server.properties güncellendi ({len(clean)} ayar)", "system")
        return {"values": {**DEFAULT_PROPERTIES, **values}, "restart_required": self.running}

    def install_engine(self, job: Job, *, progress: float | None = None) -> dict[str, Any]:
        cfg = self.cfg
        if self.running:
            raise AppError("Sunucu çalışırken motor kurulamaz")
        javas = java_manager.detect(self.store)
        required = java_manager.recommended_major(cfg["mc_version"])
        java = java_manager.resolve(javas, cfg.get("java_path", ""), required)

        def log(message: str) -> None:
            job.log(message)
            self.log(message, "install")

        def report(pct: float, message: str = "") -> None:
            job.set_progress(pct, message or None)

        log(f"Motor: {ENGINE_LABELS.get(cfg['loader'], cfg['loader'])} | Minecraft {cfg['mc_version']} | Java {java['major']}")
        if java["major"] < required:
            raise AppError(
                f"Java {required}+ gerekiyor ancak seçili Java {java['major']}.",
                detail="Ayarlar > Java bölümünden uygun sürümü indirin veya başka bir Java seçin.",
            )
        info = engines.install_engine(
            self.dir, cfg["mc_version"], cfg["loader"], java["path"],
            log=log, progress=report,
            preferred_version=cfg.get("loader_version", ""),
        )
        engines.write_engine_info(self.dir, info)
        self.ensure_server_files()
        self._write_launch_scripts(info, java["path"])
        self.store.update_server(
            self.id,
            installed=True,
            loader_version=info.get("loader_version", ""),
            engine_version=info.get("loader_version", ""),
            java_path=java["path"],
            engine_installed_at=now_iso(),
        )
        self.log("✔ Sunucu motoru hazır", "success")
        return info

    def _write_launch_scripts(self, engine: dict[str, Any], java: str) -> None:
        cfg = self.cfg
        ram_min = int(cfg.get("ram_min_mb", 1024))
        ram_max = int(cfg.get("ram_max_mb", 4096))
        extra = _split_args(cfg.get("extra_jvm_args", ""))
        flags = list(config.DEFAULT_JVM_FLAGS)
        if cfg.get("loader") in {"forge", "neoforge"}:
            jvm = [f"-Xms{ram_min}M", f"-Xmx{ram_max}M", *extra, *flags]
            args = [*engine.get("args", [])]
            if args and args[0] == "@user_jvm_args.txt":
                (self.dir / "user_jvm_args.txt").write_text("\n".join(jvm) + "\n", encoding="utf-8")
                cmd = [java, *args]
            else:
                cmd = [java, *jvm, *args]
        else:
            cmd = [java, f"-Xms{ram_min}M", f"-Xmx{ram_max}M", *extra, *flags, *engine.get("args", [])]
        try:
            if config.IS_WINDOWS:
                quoted = " ".join(f'"{part}"' if " " in part else part for part in cmd)
                (self.dir / "start.bat").write_text(
                    "@echo off\r\ncd /d \"%~dp0\"\r\necho CraftDeck tarafından oluşturuldu.\r\n"
                    + quoted + "\r\npause\r\n", encoding="utf-8")
            else:
                quoted = " ".join(shlex.quote(part) for part in cmd)
                script = self.dir / "start.sh"
                script.write_text(f"#!/usr/bin/env sh\ncd \"$(dirname \"$0\")\"\nexec {quoted}\n", encoding="utf-8")
                script.chmod(0o755)
        except OSError:
            pass

    def start(self, job: Job | None = None) -> dict[str, Any]:
        cfg = self.cfg
        with self._lock:
            if self.running:
                raise AppError("Sunucu zaten çalışıyor")
        engine = engines.read_engine_info(self.dir)
        if not engine or not cfg.get("installed"):
            raise AppError("Sunucu motoru kurulu değil",
                           detail="Önce 'Motoru Kur' işlemini çalıştırın veya bir modpack kurun.")
        required = java_manager.recommended_major(cfg["mc_version"])
        javas = java_manager.detect(self.store)
        java = java_manager.resolve(javas, cfg.get("java_path", ""), required)
        if java["major"] < required:
            raise AppError(
                f"Minecraft {cfg['mc_version']} için Java {required}+ gerekiyor",
                detail=f"Seçili Java {java['major']} ({java['path']}). Ayarlar'dan daha yeni bir Java seçin.",
            )

        self.ensure_server_files()
        port = int(cfg.get("port", 25565))
        if port_in_use(port) and not self.running:
            raise AppError(f"Port {port} başka bir program tarafından kullanılıyor",
                           detail="Ayarlar'dan farklı bir port seçin veya çakışan uygulamayı kapatın.")

        ram_min = max(256, int(cfg.get("ram_min_mb", 1024)))
        ram_max = max(ram_min, int(cfg.get("ram_max_mb", 4096)))
        extra = _split_args(cfg.get("extra_jvm_args", ""))
        if cfg.get("loader") in {"forge", "neoforge"}:
            jvm = [f"-Xms{ram_min}M", f"-Xmx{ram_max}M", *extra, *config.DEFAULT_JVM_FLAGS]
            args = list(engine.get("args", []))
            if args and args[0] == "@user_jvm_args.txt":
                (self.dir / "user_jvm_args.txt").write_text("\n".join(jvm) + "\n", encoding="utf-8")
                cmd = [java["path"], *args]
            else:
                cmd = [java["path"], *jvm, *args]
        else:
            cmd = [java["path"], f"-Xms{ram_min}M", f"-Xmx{ram_max}M", *extra,
                   *config.DEFAULT_JVM_FLAGS, *engine.get("args", [])]

        if job:
            job.log("Sunucu başlatılıyor: " + " ".join(cmd))
        with self._lock:
            self._status = "starting"
            self._stopping = False
            self._error = ""
            self._exit_code = None
            self._started_at = time.time()
            self._players.clear()
            self.log("────────────────────────────────────────────", "system")
            self.log(f"▶ {self.name} başlatılıyor ({ENGINE_LABELS.get(cfg['loader'], cfg['loader'])}, MC {cfg['mc_version']})", "success")
            self.log("$ " + " ".join(cmd), "command")
            self.log(f"Java: {java['path']} ({java['version']})", "system")
            try:
                self._proc = subprocess.Popen(
                    cmd, cwd=str(self.dir),
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    bufsize=0,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0) if config.IS_WINDOWS else 0,
                    start_new_session=not config.IS_WINDOWS,
                )
            except OSError as exc:
                self._status = "crashed"
                self._error = f"Sunucu başlatılamadı: {exc}"
                self.log(self._error, "error")
                raise AppError(self._error, detail="Java yolunu ve dosya izinlerini kontrol edin.") from exc
        threading.Thread(target=self._reader, args=(self._proc,), name=f"console-{self.id}", daemon=True).start()
        threading.Thread(target=self._watchdog, args=(self._proc, java), name=f"watch-{self.id}", daemon=True).start()
        return self.state()

    def _reader(self, proc: subprocess.Popen) -> None:
        assert proc.stdout is not None
        try:
            for raw in proc.stdout:
                line = decode_process_text(raw).rstrip("\r\n")
                if not line:
                    continue
                with self._lock:
                    self._seq += 1
                    self._logs.append({"seq": self._seq, "t": time.time(), "stream": "stdout", "text": line})
                if DONE_RE.search(line):
                    with self._lock:
                        self._status = "running"
                    self.log("✔ Sunucu hazır! Oyuncular katılabilir.", "success")
                match = JOIN_RE.search(line)
                if match:
                    with self._lock:
                        self._players.add(match.group(1))
                    self.log(f"➕ {match.group(1)} katıldı", "success")
                match = LEAVE_RE.search(line)
                if match:
                    with self._lock:
                        self._players.discard(match.group(1))
                    self.log(f"➖ {match.group(1)} ayrıldı", "system")
        except (OSError, ValueError):
            pass

    def _watchdog(self, proc: subprocess.Popen, java: dict[str, Any]) -> None:
        code = proc.wait()
        with self._lock:
            was_stopping = self._stopping
            self._proc = None
            self._exit_code = code
            self._players.clear()
            if was_stopping:
                self._status = "stopped"
            elif code != 0:
                self._status = "crashed"
                self._error = f"Sunucu beklenmedik şekilde kapandı (çıkış kodu {code})"
            else:
                self._status = "stopped"
        self.log(f"■ Sunucu kapandı (kod {code})", "error" if code and not was_stopping else "system")
        if code != 0 and not was_stopping:
            self.log("İpucu: logs/latest.log ve crash-reports klasörünü inceleyin.", "warn")
            cfg = self.cfg
            now = time.time()
            if cfg.get("auto_restart") and now - self._last_restart > 20:
                self._restart_count += 1
                self._last_restart = now
                if self._restart_count <= 3:
                    self.log(f"↻ Otomatik yeniden başlatma ({self._restart_count}/3) 5 saniye içinde…", "warn")
                    time.sleep(5)
                    try:
                        if self.store.get_server(self.id):
                            self.start()
                            time.sleep(30)
                            self._restart_count = 0
                    except Exception as exc:
                        self.log(f"Otomatik yeniden başlatma başarısız: {exc}", "error")

    def stop(self, *, wait: bool = True) -> dict[str, Any]:
        with self._lock:
            proc = self._proc
            if proc is None or proc.poll() is not None:
                self._status = "stopped"
                return self.state()
            self._stopping = True
            self._status = "stopping"
        self.log("⏹ Durdurma isteği gönderiliyor ('stop')…", "system")
        try:
            if proc.stdin:
                proc.stdin.write(b"stop\n")
                proc.stdin.flush()
        except (OSError, ValueError):
            pass
        if wait:
            deadline = time.time() + 35
            while time.time() < deadline and proc.poll() is None:
                time.sleep(0.25)
            if proc.poll() is None:
                self.log("Sunucu 35 saniyede kapanmadı, zorla sonlandırılıyor…", "warn")
                terminate_process_tree(proc)
            time.sleep(0.4)
        else:
            def delayed() -> None:
                deadline = time.time() + 35
                while time.time() < deadline and proc.poll() is None:
                    time.sleep(0.5)
                if proc.poll() is None:
                    self.log("Sunucu 35 saniyede kapanmadı, zorla sonlandırılıyor…", "warn")
                    terminate_process_tree(proc)

            threading.Thread(target=delayed, name=f"stop-{self.id}", daemon=True).start()
        return self.state()

    def kill(self) -> dict[str, Any]:
        with self._lock:
            proc = self._proc
            self._stopping = True
        if proc and proc.poll() is None:
            self.log("⛔ Sunucu zorla kapatılıyor", "warn")
            terminate_process_tree(proc)
        with self._lock:
            self._status = "stopped"
            self._proc = None
        return self.state()

    def restart(self) -> dict[str, Any]:
        self.stop()
        time.sleep(0.6)
        return self.start()

    def send(self, command: str) -> dict[str, Any]:
        command = (command or "").strip()
        if not command:
            raise AppError("Komut boş olamaz")
        with self._lock:
            proc = self._proc
        if not proc or proc.poll() is not None or not proc.stdin:
            raise AppError("Sunucu çalışmıyor")
        try:
            proc.stdin.write((command + "\n").encode("utf-8"))
            proc.stdin.flush()
        except (OSError, ValueError) as exc:
            raise AppError("Komut gönderilemedi", detail=str(exc)) from exc
        self.log("> " + command, "command")
        return {"ok": True}

    def state(self) -> dict[str, Any]:
        cfg = self.cfg
        engine = engines.read_engine_info(self.dir)
        with self._lock:
            status = self._status
            players = sorted(self._players)
            started = self._started_at
            seq = self._seq
        if not self.running and status in {"running", "starting", "stopping"}:
            status = "stopped"
        tunnel = self.tunnel.snapshot(since=10**9)
        address = cfg.get("tunnel", {}).get("manual_address") or tunnel.get("address") or cfg.get("tunnel", {}).get("auto_address", "")
        return {
            "id": self.id,
            "name": cfg.get("name"),
            "status": status,
            "running": self.running,
            "uptime": int(time.time() - started) if self.running and started else 0,
            "players": players,
            "player_count": len(players),
            "port": cfg.get("port"),
            "address": address,
            "tunnel": tunnel,
            "mc_version": cfg.get("mc_version"),
            "loader": cfg.get("loader"),
            "loader_label": ENGINE_LABELS.get(cfg.get("loader"), cfg.get("loader")),
            "loader_version": cfg.get("loader_version"),
            "installed": bool(engine),
            "engine": engine,
            "java_path": cfg.get("java_path"),
            "java_required": java_manager.recommended_major(cfg.get("mc_version", "")),
            "ram_min_mb": cfg.get("ram_min_mb"),
            "ram_max_mb": cfg.get("ram_max_mb"),
            "auto_restart": cfg.get("auto_restart"),
            "mrpack": cfg.get("mrpack"),
            "last_exit_code": self._exit_code,
            "error": self._error,
            "last_seq": seq,
            "port_busy": port_in_use(int(cfg.get("port", 25565))) if not self.running else False,
            "job": self.manager.jobs.active_for(self.id),
        }

    def _persist_address(self, address: str) -> None:
        try:
            cfg = self.cfg
            tunnel = dict(cfg.get("tunnel") or {})
            tunnel["auto_address"] = address
            self.store.update_server(self.id, tunnel=tunnel)
        except Exception:
            pass

    def _content_index(self) -> dict[str, Any]:
        data = read_json(self._content_index_path, {})
        return data if isinstance(data, dict) else {}

    def _save_content_index(self, data: dict[str, Any]) -> None:
        write_json(self._content_index_path, data)

    def list_content(self) -> dict[str, Any]:
        index = self._content_index()
        group_names = {"mod": "mods", "plugin": "plugins", "resourcepack": "resourcepacks",
                       "shader": "shaderpacks", "datapack": "datapacks"}
        groups: dict[str, list[dict[str, Any]]] = {name: [] for name in group_names.values()}
        for kind, folder in CONTENT_DIRS.items():
            root = safe_join(self.dir, folder)
            if not root.exists():
                continue
            for path in sorted(root.iterdir()):
                if not path.is_file() or path.name.startswith("."):
                    continue
                if path.suffix.lower() not in {".jar", ".zip", ".mrpack"} and not path.name.endswith(".jar.disabled"):
                    continue
                rel = path.relative_to(self.dir).as_posix()
                meta = index.get(rel, {})
                groups[group_names[kind]].append({
                    "path": rel,
                    "name": path.name,
                    "size": path.stat().st_size,
                    "mtime": int(path.stat().st_mtime),
                    "type": kind,
                    "project_id": meta.get("project_id"),
                    "title": meta.get("title") or path.name,
                    "version_number": meta.get("version_number"),
                    "installed_at": meta.get("installed_at"),
                })
        for items in groups.values():
            items.sort(key=lambda item: item["name"].lower())
        return {"groups": groups, "total": sum(len(v) for v in groups.values())}

    def delete_content(self, rel_path: str) -> dict[str, Any]:
        rel = rel_path.replace("\\", "/").lstrip("/")
        allowed = tuple(CONTENT_DIRS.values())
        if not rel.startswith(allowed) or ".." in rel.split("/"):
            raise AppError("Bu dosya silinemez (geçersiz yol)", detail=rel)
        target = safe_join(self.dir, rel)
        if not target.is_file():
            raise AppError("Dosya bulunamadı", status=404, detail=rel)
        target.unlink()
        index = self._content_index()
        index.pop(rel, None)
        self._save_content_index(index)
        self.log(f"🗑 Silindi: {rel}", "system")
        return {"ok": True, "path": rel}

    def _content_kind(self, project_type: str, version: dict[str, Any]) -> str:
        if project_type not in {"mod", "plugin"}:
            return project_type
        loaders = {str(item).lower() for item in (version.get("loaders") or [])}
        if loaders & PLUGIN_SERVER_LOADERS:
            return "plugin"
        if loaders & MOD_SERVER_LOADERS:
            return "mod"
        return "plugin" if self.cfg["loader"] in PLUGIN_SERVER_LOADERS else "mod"

    def _target_dir(self, project_type: str) -> pathlib.Path:
        if project_type == "datapack":
            world = read_properties(self.properties_path()).get("level-name", "world") or "world"
            folder = f"{world}/datapacks"
        else:
            folder = CONTENT_DIRS.get(project_type)
        if not folder:
            raise AppError(f"'{project_type}' türü sunucuya kurulamaz")
        target = safe_join(self.dir, folder)
        target.mkdir(parents=True, exist_ok=True)
        return target

    def install_project(self, project_id: str, version_id: str | None, *, with_dependencies: bool = True,
                        job: Job | None = None) -> dict[str, Any]:
        cfg = self.cfg
        project = self.manager.modrinth.project(project_id)
        if project.get("type") == "modpack":
            return self.install_modpack_project(project["id"], version_id, job=job)
        ptype = project.get("type")
        if ptype not in {"mod", "plugin", "datapack", "shader", "resourcepack"}:
            raise AppError(f"Desteklenmeyen proje türü: {ptype}")
        compat_warning = self.manager.modrinth.check_server_compat(project, cfg["loader"])
        if compat_warning:
            if is_client_only(project):
                raise AppError(compat_warning)
            if job:
                job.log("⚠ " + compat_warning)

        try:
            if version_id:
                version = self.manager.modrinth.version(version_id)
            else:
                version = self.manager.modrinth.pick_version(
                    project_id, loader=cfg["loader"], game_version=cfg["mc_version"])
        except AppError as exc:
            if ptype == "mod" and cfg["loader"] in PLUGIN_SERVER_LOADERS:
                raise AppError(
                    f"{project.get('title')} için {cfg['loader'].capitalize()} uyumlu bir plugin sürümü yok.",
                    detail="Proje yalnızca mod yükleyicileri için yayınlanmış olabilir. "
                           "Bir plugin alternatifi arayın veya Fabric/NeoForge/Forge sunucusu kullanın.",
                ) from exc
            if ptype == "plugin" and cfg["loader"] in MOD_SERVER_LOADERS:
                raise AppError(
                    f"{project.get('title')} için {cfg['loader'].capitalize()} uyumlu bir mod sürümü yok.",
                    detail="Proje yalnızca sunucu plugin'i olarak yayınlanmış olabilir. Paper/Purpur kullanın.",
                ) from exc
            raise
        if cfg["mc_version"] not in (version.get("game_versions") or []) and job:
            job.log(f"⚠ Bu dosya Minecraft {', '.join(version.get('game_versions') or [])} için; "
                    f"sunucu {cfg['mc_version']}.")

        primary = self.manager.modrinth.primary_file(version)
        if not primary:
            raise AppError("Seçilen sürümde indirilebilir dosya yok")

        entries: list[dict[str, Any]] = [{"project": project, "version": version, "file": primary}]
        if with_dependencies:
            deps, warnings = self.manager.modrinth.resolve_dependencies(
                version, loader=cfg["loader"], game_version=cfg["mc_version"])
            for warning in warnings:
                if job:
                    job.log("⚠ " + warning)
            entries.extend(deps)

        unique: dict[str, dict[str, Any]] = {}
        for entry in entries:
            key = entry["version"]["id"] + ":" + entry["file"]["filename"]
            unique[key] = entry
        entries = list(unique.values())

        installed: list[dict[str, Any]] = []
        total = max(1, len(entries))
        for position, entry in enumerate(entries, start=1):
            if job and job.cancelled:
                raise AppError("Kurulum iptal edildi")
            dep_project = entry["project"]
            dep_version = entry["version"]
            file = entry["file"]
            dep_type = self._content_kind(dep_project.get("type", "mod"), dep_version)
            if dep_type == "mod" and cfg["loader"] not in MOD_SERVER_LOADERS:
                if job:
                    job.log(f"⚠ {dep_project.get('title')} bir mod; {cfg['loader']} sunucusuna kurulmadı")
                continue
            if dep_type == "plugin" and cfg["loader"] not in PLUGIN_SERVER_LOADERS:
                if job:
                    job.log(f"⚠ {dep_project.get('title')} bir plugin; {cfg['loader']} sunucusuna kurulmadı")
                continue
            target_dir = self._target_dir(dep_type)
            filename = pathlib.Path(str(file.get("filename") or "download.jar")).name
            target = target_dir / filename
            if job:
                job.log(f"↓ {dep_project.get('title')} → {target.relative_to(self.dir).as_posix()}")
            download_file(file["url"], target, hashes=file.get("hashes") or None, retries=3)
            self._remove_previous_files(dep_project.get("id"), target.relative_to(self.dir).as_posix())
            index = self._content_index()
            index[target.relative_to(self.dir).as_posix()] = {
                "project_id": dep_project.get("id"),
                "title": dep_project.get("title"),
                "version_id": dep_version.get("id"),
                "version_number": dep_version.get("version_number"),
                "installed_at": now_iso(),
                "type": dep_type,
            }
            self._save_content_index(index)
            self.log(f"✔ Kuruldu: {filename}", "success")
            installed.append({"title": dep_project.get("title"), "filename": filename,
                              "version": dep_version.get("version_number")})
            if job:
                job.set_progress(position / total * 100, f"{position}/{total}: {filename}")
        return {"installed": installed, "count": len(installed)}

    def _remove_previous_files(self, project_id: str | None, keep_rel: str) -> None:
        if not project_id:
            return
        index = self._content_index()
        changed = False
        for rel, meta in list(index.items()):
            if meta.get("project_id") == project_id and rel != keep_rel:
                try:
                    target = safe_join(self.dir, rel)
                    if target.is_file():
                        target.unlink()
                except (OSError, AppError):
                    pass
                index.pop(rel, None)
                changed = True
        if changed:
            self._save_content_index(index)

    def install_mrpack(self, path: pathlib.Path, job: Job | None = None, *,
                       set_identity: bool = True) -> dict[str, Any]:
        pack = mrpack.read_mrpack(path)
        cfg = self.cfg

        def log(message: str) -> None:
            if job:
                job.log(message)
            self.log(message, "install")

        log(f"📦 {pack['name']} | Minecraft {pack['mc_version']} | {pack['loader']}")
        log(f"   {pack['file_count']} dosya, {pack['override_count']} override")

        loader_changed = (cfg.get("mc_version") != pack["mc_version"] or cfg.get("loader") != pack["loader"])
        if set_identity:
            self.store.update_server(
                self.id,
                mc_version=pack["mc_version"],
                loader=pack["loader"],
                loader_version=pack["loader_version"],
                installed=False if loader_changed else cfg.get("installed", False),
            )
            if pack["name"] and (cfg.get("name") in {"Yeni Sunucu", "Yeni Modpack"} or not cfg.get("name")):
                self.store.update_server(self.id, name=mrpack.suggest_server_name(pack)[:48])
        cfg = self.cfg
        if job:
            job.set_progress(5, "Paket doğrulandı")

        engine = engines.read_engine_info(self.dir)
        needs_engine = engine is None or loader_changed or not cfg.get("installed")
        if needs_engine:
            log("Motor kuruluyor / güncelleniyor…")
            self.install_engine(job or self.manager.jobs.create(f"{self.id}: motor", f"{self.id}:engine"))
            if job:
                job.set_progress(35, "Motor hazır, dosyalar indiriliyor")
        else:
            log("Mevcut motor kullanılabilir")

        self.ensure_server_files()
        stats = mrpack.install_files(
            self.dir, {"files": pack["files"]}, log=log,
            progress=(lambda pct, msg: job.set_progress(35 + pct * 0.55, msg)) if job else None,
            cancelled=(lambda: bool(job and job.cancelled)),
        )
        if job:
            job.set_progress(92, "Override dosyaları çıkarılıyor")
        overrides = mrpack.extract_overrides(path, self.dir, log=log)
        self.ensure_server_files()
        self.store.update_server(
            self.id,
            installed=True,
            mrpack={
                "name": pack["name"],
                "version_id": pack["version_id"],
                "file_count": len(pack["files"]),
                "override_count": overrides,
                "installed_at": now_iso(),
                "source": str(path.name),
            },
        )
        log(f"✔ Modpack kuruldu: {stats['downloaded']} dosya, {stats['skipped']} atlandı, {overrides} override")
        if stats["failed"]:
            raise AppError(
                f"{len(stats['failed'])} dosya indirilemedi",
                detail="Başarısız dosyalar: " + ", ".join(stats["failed"][:12]),
            )
        return {"pack": pack, "downloaded": stats["downloaded"], "overrides": overrides}

    def install_modpack_project(self, project_id: str, version_id: str | None,
                                job: Job | None = None) -> dict[str, Any]:
        if version_id:
            version = self.manager.modrinth.version(version_id)
        else:
            loader = self.cfg.get("loader") or ""
            version = (
                self.manager.modrinth.compatible_version(
                    project_id,
                    loader=loader if loader in MOD_SERVER_LOADERS else "",
                    game_version=self.cfg.get("mc_version") or "",
                )
                or self.manager.modrinth.pick_version(project_id)
            )
        if version.get("project_id") != project_id:
            raise AppError("Sürüm bu modpack'e ait değil")
        primary = self.manager.modrinth.primary_file(version)
        if not primary:
            raise AppError("Modpack dosyası bulunamadı")
        target = config.UPLOAD_DIR / f"{version['id']}-{pathlib.Path(primary['filename']).name}"

        def progress(done: int, total: int) -> None:
            if job and total:
                job.set_progress(min(20, done / total * 20), "Modpack indiriliyor")

        if job:
            job.log(f"↓ Modpack indiriliyor: {primary['filename']}")
        download_file(primary["url"], target, hashes=primary.get("hashes") or None,
                      progress=progress, retries=3)

        if job:
            job.set_progress(20, "Modpack indirildi")
        try:
            result = self.install_mrpack(target, job=job)
            cfg = self.cfg
            self.store.update_server(self.id, mrpack={
                **(cfg.get("mrpack") or {}),
                "project_id": project_id,
                "version_id": version.get("id"),
                "project_version": version.get("version_number"),
                "project_name": self.manager.modrinth.project(project_id).get("title"),
            })
            return result
        finally:
            target.unlink(missing_ok=True)

    def player_action(self, action: str, player: str) -> dict[str, Any]:
        player = re.sub(r"[^A-Za-z0-9_]", "", player or "")
        if not player:
            raise AppError("Geçersiz oyuncu adı")
        commands = {
            "op": f"op {player}",
            "deop": f"deop {player}",
            "kick": f"kick {player}",
            "ban": f"ban {player}",
            "pardon": f"pardon {player}",
            "whitelist_add": f"whitelist add {player}",
            "whitelist_remove": f"whitelist remove {player}",
        }
        if action not in commands:
            raise AppError("Bilinmeyen oyuncu işlemi")
        result = self.send(commands[action])
        return {**result, "command": commands[action]}

    def shutdown(self) -> None:
        try:
            self.tunnel.shutdown()
        finally:
            with self._lock:
                proc = self._proc
                self._stopping = True
            if proc and proc.poll() is None:
                try:
                    if proc.stdin:
                        proc.stdin.write(b"stop\n")
                        proc.stdin.flush()
                        time.sleep(2)
                except Exception:
                    pass
                terminate_process_tree(proc)

    def delete(self, *, delete_files: bool = False) -> None:
        self.shutdown()
        if delete_files:
            shutil.rmtree(self.dir, ignore_errors=True)
        self.store.delete_server(self.id)


class ServerManager:
    def __init__(self, store: Store, jobs: JobManager, modrinth: Modrinth) -> None:
        self.store = store
        self.jobs = jobs
        self.modrinth = modrinth
        self._runtimes: dict[str, ServerRuntime] = {}
        self._lock = threading.RLock()

    def runtime(self, server_id: str) -> ServerRuntime:
        with self._lock:
            runtime = self._runtimes.get(server_id)
            if runtime:
                return runtime
            record = self.store.get_server(server_id)
            if not record:
                raise AppError("Sunucu bulunamadı", status=404)
            runtime = ServerRuntime(self, record)
            self._runtimes[server_id] = runtime
            return runtime

    def create_server(self, name: str, mc_version: str, loader: str, *, port: int | None = None,
                      ram_min_mb: int = 1024, ram_max_mb: int = 4096,
                      java_path: str = "") -> dict[str, Any]:
        if loader not in config.LOADER_IDS:
            raise AppError(f"Geçersiz yükleyici: {loader}")
        if not re.match(r"^[0-9][0-9A-Za-z.\-]{0,24}$", mc_version or ""):
            raise AppError("Geçersiz Minecraft sürümü")
        if port is None:
            port = 25565
            while port_in_use(port) and port < 26000:
                port += 1
        ram_min_mb = max(256, min(int(ram_min_mb), 65536))
        ram_max_mb = max(ram_min_mb, min(int(ram_max_mb), 65536))
        record = self.store.create_server(name, mc_version, loader, port=port,
                                          ram_min_mb=ram_min_mb, ram_max_mb=ram_max_mb,
                                          java_path=java_path)
        runtime = self.runtime(record["id"])
        runtime.ensure_server_files()
        runtime.log(f"Sunucu oluşturuldu: {record['name']} ({mc_version}, {loader})", "success")
        return runtime.state()

    def prepare_from_mrpack(self, path: pathlib.Path, name: str | None = None) -> tuple[ServerRuntime, dict[str, Any]]:
        pack = mrpack.read_mrpack(path)
        record = self.store.create_server(
            (name or mrpack.suggest_server_name(pack))[:48],
            pack["mc_version"],
            pack["loader"],
            port=None,
            ram_max_mb=4096,
        )
        runtime = self.runtime(record["id"])
        return runtime, pack

    def list_servers(self) -> list[dict[str, Any]]:
        return [self.runtime(record["id"]).state() for record in self.store.list_servers()]

    def shutdown_all(self) -> None:
        with self._lock:
            runtimes = list(self._runtimes.values())
        for runtime in runtimes:
            try:
                runtime.shutdown()
            except Exception:
                pass
