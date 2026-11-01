from __future__ import annotations

import json
import pathlib
import platform
import re
import subprocess
import threading
import time
import urllib.request
import zipfile
from collections import deque
from typing import Any, Callable

from . import config
from .util import ApiError, AppError, decode_process_text, download_file, free_port, http_json, terminate_process_tree

ADDRESS_RE = re.compile(
    r"(?:(?:tcp|tls)://)?"
    r"((?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+"
    r"(?:ngrok\.(?:io|app|dev)|playit\.gg|joinmc\.link|ply\.gg|at\.ply\.gg|bore\.pub|localhost\.run|lhr\.life|serveo\.net|trycloudflare\.com))"
    r"(?::(\d{2,5}))?",
    re.IGNORECASE,
)
CLAIM_RE = re.compile(r"https://playit\.gg/claim/[\w-]+", re.IGNORECASE)
KNOWN_DOMAINS = ("ngrok", "playit", "joinmc", "ply.gg", "bore.pub", "localhost.run", "lhr.life", "serveo", "trycloudflare")


def _creation_flags() -> int:
    return getattr(subprocess, "CREATE_NO_WINDOW", 0) if config.IS_WINDOWS else 0


def ensure_ngrok(log: Callable[[str], None], progress: Callable[[int, int], None] | None = None) -> pathlib.Path:
    target = config.BIN_DIR / ("ngrok.exe" if config.IS_WINDOWS else "ngrok")
    if target.exists() and target.stat().st_size > 1_000_000:
        return target
    config.BIN_DIR.mkdir(parents=True, exist_ok=True)
    if config.IS_WINDOWS:
        name = "ngrok-v3-stable-windows-amd64.zip"
    elif config.IS_MAC:
        name = "ngrok-v3-stable-darwin-arm64.zip" if config.ARCH == "aarch64" else "ngrok-v3-stable-darwin-amd64.zip"
    else:
        suffix = "arm64" if config.ARCH == "aarch64" else ("arm" if platform.machine().lower().startswith("arm") else "amd64")
        name = f"ngrok-v3-stable-linux-{suffix}.zip"
    archive = config.CACHE_DIR / name
    log("ngrok istemcisi indiriliyor (tek seferlik, ~12 MB)…")
    download_file(f"https://bin.equinox.io/c/bNyj1mQVY4c/{name}", archive, progress=progress, timeout=120)
    with zipfile.ZipFile(archive) as zf:
        zf.extractall(config.BIN_DIR)
    exe = config.BIN_DIR / ("ngrok.exe" if config.IS_WINDOWS else "ngrok")
    if not exe.exists():
        raise ApiError("ngrok arşivi beklenen dosyayı içermiyor")
    if not config.IS_WINDOWS:
        exe.chmod(0o755)
    log(f"ngrok hazır: {exe}")
    return exe


def playit_asset() -> str:
    machine = platform.machine().lower()
    if config.IS_WINDOWS:
        if machine in {"arm64", "aarch64"}:
            return "playit-windows-x86_64.exe"
        if machine in {"x86", "i386", "i686"}:
            return "playit-windows-x86.exe"
        return "playit-windows-x86_64.exe"
    if config.IS_MAC:
        raise AppError(
            "Playit.gg macOS için CLI ikilisi yayınlamıyor.",
            detail="Playit'i playit.gg üzerinden kurabilir veya ngrok kullanabilirsiniz.",
        )
    if machine in {"aarch64", "arm64"}:
        return "playit-linux-aarch64"
    if machine.startswith("armv7") or machine.startswith("arm"):
        return "playit-linux-armv7"
    if machine in {"x86", "i386", "i686"}:
        return "playit-linux-i686"
    return "playit-linux-amd64"


def ensure_playit(log: Callable[[str], None], progress: Callable[[int, int], None] | None = None) -> pathlib.Path:
    asset = playit_asset()
    target = config.BIN_DIR / ("playit.exe" if config.IS_WINDOWS else "playit")
    if target.exists() and target.stat().st_size > 1_000_000:
        return target
    config.BIN_DIR.mkdir(parents=True, exist_ok=True)
    log(f"Playit.gg istemcisi indiriliyor ({asset})…")
    download_file(
        f"https://github.com/playit-cloud/playit-agent/releases/latest/download/{asset}",
        target, progress=progress, timeout=120,
    )
    if not config.IS_WINDOWS:
        target.chmod(0o755)
    log(f"Playit hazır: {target}")
    return target


class TunnelManager:
    def __init__(self, server_id: str, get_port: Callable[[], int],
                 on_address: Callable[[str], None] | None = None) -> None:
        self.server_id = server_id
        self._get_port = get_port
        self._on_address = on_address
        self._lock = threading.RLock()
        self._proc: subprocess.Popen | None = None
        self._thread: threading.Thread | None = None
        self._stopping = False
        self._logs: deque[dict[str, Any]] = deque(maxlen=800)
        self._seq = 0
        self.provider = "none"
        self.status = "idle"
        self.address = ""
        self.claim_url = ""
        self.error = ""
        self.started_at = 0.0
        self.api_port = 0
        self.ngrok_token = ""

    def _log(self, text: str, stream: str = "tunnel") -> None:
        with self._lock:
            self._seq += 1
            self._logs.append({"seq": self._seq, "t": time.time(), "stream": stream, "text": str(text).rstrip()})
            if len(self._logs) > 800:
                del self._logs[: len(self._logs) - 800]

    def set_address(self, address: str) -> None:
        address = address.strip()
        if not address:
            return
        with self._lock:
            if address != self.address:
                self.address = address
                self._log(f"🌐 Genel adres: {address}", "success")
        if self._on_address:
            try:
                self._on_address(address)
            except Exception:
                pass

    def _scan_line(self, line: str) -> None:
        for match in CLAIM_RE.finditer(line):
            with self._lock:
                self.claim_url = match.group(0)
        for match in ADDRESS_RE.finditer(line):
            host = match.group(1)
            port = match.group(2)
            if not any(domain in host.lower() for domain in KNOWN_DOMAINS):
                continue
            self.set_address(f"{host}:{port}" if port else host)

    def snapshot(self, *, since: int = 0) -> dict[str, Any]:
        with self._lock:
            lines = [line for line in self._logs if line["seq"] > since]
            return {
                "server_id": self.server_id,
                "provider": self.provider,
                "status": self.status,
                "address": self.address,
                "claim_url": self.claim_url,
                "error": self.error,
                "started_at": self.started_at,
                "running": self._proc is not None and self._proc.poll() is None,
                "logs": lines,
                "last_seq": self._seq,
            }

    def clear_logs(self) -> None:
        with self._lock:
            self._logs.clear()

    def reset(self) -> dict[str, Any]:
        self.stop(wait=True)
        with self._lock:
            self._logs.clear()
            self.address = ""
            self.claim_url = ""
            self.error = ""
            self.status = "idle"
            self.provider = "none"
            self.ngrok_token = ""
            self.started_at = 0.0
        return self.snapshot()

    def start(self, provider: str, token: str = "", command: str = "") -> dict[str, Any]:
        if provider not in {"ngrok", "playit", "custom"}:
            raise AppError("Geçersiz tünel sağlayıcısı")
        self.stop(wait=True)
        with self._lock:
            self.provider = provider
            self.status = "starting"
            self.address = ""
            self.error = ""
            self.claim_url = ""
            self.ngrok_token = token
            self.started_at = time.time()
            self._stopping = False
            self._logs.clear()
        self._log(f"Tünel başlatılıyor: {provider}")
        self._thread = threading.Thread(target=self._run, args=(provider, token, command),
                                        name=f"tunnel-{self.server_id}", daemon=True)
        self._thread.start()
        return self.snapshot()

    def _run(self, provider: str, token: str, command: str) -> None:
        try:
            port = int(self._get_port())
            if self._stopping:
                return
            if provider == "ngrok":
                if not token.strip():
                    raise AppError(
                        "Ngrok için authtoken gerekli",
                        detail="Ücretsiz ngrok hesabı açıp dashboard'dan authtoken alın ve Tünel sekmesine girin. "
                               "Token olmadan ngrok tünel açmaz.",
                    )
                exe = ensure_ngrok(self._log)
            elif provider == "playit":
                exe = ensure_playit(self._log)
            else:
                exe = None
            if self._stopping:
                return
            if provider == "ngrok":
                self._start_ngrok(exe, port, token)
            elif provider == "playit":
                self._start_playit(exe)
            else:
                self._start_custom(command, port)
            if self._proc is None:
                if self._stopping:
                    return
                raise ApiError("Tünel süreci başlatılamadı")
            with self._lock:
                self.status = "running"
            self._log("Tünel çalışıyor. Adres algılanmazsa elle girebilirsiniz.", "success")
            self._pump()
            code = self._proc.wait() if self._proc else -1
            with self._lock:
                if self._stopping:
                    self.status = "stopped"
                else:
                    self.status = "error"
                    self.error = f"Tünel süreci beklenmedik şekilde kapandı (kod {code})"
                    self.address = ""
            self._log(self.error or "Tünel durduruldu.", "error" if not self._stopping else "info")
        except Exception as exc:
            with self._lock:
                self.status = "error"
                self.error = getattr(exc, "message", str(exc))
            self._log(f"✖ {self.error}", "error")
        finally:
            with self._lock:
                if self.status == "running":
                    self.status = "stopped"

    def _spawn(self, cmd: list[str], cwd: pathlib.Path | None = None) -> None:
        self._log("$ " + " ".join(cmd))
        kwargs: dict[str, Any] = {
            "cwd": str(cwd or config.BIN_DIR),
            "stdout": subprocess.PIPE,
            "stderr": subprocess.STDOUT,
            "stdin": subprocess.DEVNULL,
            "bufsize": 0,
            "creationflags": _creation_flags(),
        }
        if not config.IS_WINDOWS:
            kwargs["start_new_session"] = True
        self._proc = subprocess.Popen(cmd, **kwargs)

    def _pump(self) -> None:
        proc = self._proc
        if not proc or not proc.stdout:
            return
        for line in proc.stdout:
            text = decode_process_text(line).rstrip()
            if not text:
                continue
            self._log(text)
            self._scan_line(text)
            if self._stopping:
                break

    def _start_ngrok(self, exe: pathlib.Path, port: int, token: str) -> None:
        if not token.strip():
            raise AppError(
                "Ngrok için authtoken gerekli",
                detail="Ücretsiz ngrok hesabı açıp dashboard'dan authtoken alın ve Tünel sekmesine girin. "
                       "Token olmadan ngrok tünel açmaz.",
            )
        api_port = free_port(4040, 4240)
        self.api_port = api_port
        config_file = config.CACHE_DIR / f"ngrok-{self.server_id}.yml"
        lines = [
            'version: "3"',
            f"web_addr: 127.0.0.1:{api_port}",
            f'authtoken: "{token.strip()}"',
        ]
        config_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
        self._log(f"ngrok TCP tüneli → 127.0.0.1:{port} (yerel API: {api_port})")
        self._spawn([
            str(exe), "tcp", str(port),
            "--config", str(config_file),
            "--log", "stdout", "--log-format", "logfmt",
        ])
        threading.Thread(target=self._watch_ngrok, args=(api_port,), daemon=True).start()

    def _watch_ngrok(self, api_port: int) -> None:
        deadline = time.time() + 45
        while time.time() < deadline:
            if self._stopping or (self._proc and self._proc.poll() is not None):
                return
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{api_port}/api/tunnels", timeout=2) as resp:
                    data = json.loads(resp.read().decode("utf-8", "replace"))
                for tunnel in data.get("tunnels") or []:
                    url = str(tunnel.get("public_url") or "")
                    if url.startswith("tcp://"):
                        self.set_address(url[len("tcp://"):])
                        return
            except Exception:
                pass
            time.sleep(1.2)
        if not self.address:
            self._log("ngrok adresi otomatik alınamadı. Token'ı ve logları kontrol edin.", "warn")

    def _start_playit(self, exe: pathlib.Path) -> None:
        self._log("Playit.gg ajanı başlatılıyor (mevcut hesap yapılandırması kullanılır)…")
        self._spawn([str(exe), "--stdout"])
        self._log("Playit tünelleri playit.gg panelinden bu sunucu portuna yönlendirilmelidir.", "info")
        self._log("Panel: https://playit.gg/account/tunnels", "info")

    def _start_custom(self, command: str, port: int) -> None:
        command = (command or "").strip()
        if not command:
            raise AppError("Özel tünel için bir komut girin",
                           detail='Örnek: bore local {port} --to bore.pub')
        resolved = command.replace("{port}", str(port))
        self._log(f"Özel tünel komutu: {resolved}")
        kwargs: dict[str, Any] = {
            "cwd": str(config.BIN_DIR),
            "stdout": subprocess.PIPE,
            "stderr": subprocess.STDOUT,
            "stdin": subprocess.DEVNULL,
            "text": True,
            "encoding": "utf-8",
            "errors": "replace",
            "bufsize": 1,
            "shell": True,
            "creationflags": _creation_flags(),
        }
        if not config.IS_WINDOWS:
            kwargs["start_new_session"] = True
        self._proc = subprocess.Popen(resolved, **kwargs)

    def stop(self, *, wait: bool = False) -> dict[str, Any]:
        with self._lock:
            self._stopping = True
            proc = self._proc
            self._proc = None
        if proc is not None:
            self._log("Tünel durduruluyor…")
            terminate_process_tree(proc)
        with self._lock:
            if self.status in {"running", "starting", "error"}:
                self.status = "stopped"
        if wait and self._thread and self._thread.is_alive() and self._thread is not threading.current_thread():
            self._thread.join(timeout=5)
        return self.snapshot()

    def shutdown(self) -> None:
        self.stop(wait=False)
