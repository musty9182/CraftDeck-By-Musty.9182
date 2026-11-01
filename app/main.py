from __future__ import annotations

import argparse
import atexit
import json
import os
import pathlib
import socket
import subprocess
import sys
import threading
import time
import webbrowser

from . import config
from .api import AppContext, make_server
from .jobs import JobManager
from .modrinth import Modrinth
from .server import ServerManager
from .store import Store, now_iso


BANNER = r"""
   ______           __  ____             __
  / ____/________ _/ /_/ __ \___  _____/ /__
 / /   / ___/ __ `/ __/ / / / _ \/ ___/ //_/
/ /___/ /  / /_/ / /_/ /_/ /  __/ /__/ ,<
\____/_/   \__,_/\__/_____/\___/\___/_/|_|
"""


def _port_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind((host, port))
            return True
        except OSError:
            return False


def _pick_port(host: str, preferred: int) -> int:
    for port in range(preferred, preferred + config.PORT_SCAN_RANGE):
        if _port_free(host, port):
            return port
    raise SystemExit(f"Boş port bulunamadı ({preferred}-{preferred + config.PORT_SCAN_RANGE})")


def _open_ui(url: str, *, app_window: bool) -> None:
    if app_window and config.IS_WINDOWS:
        candidates = [
            pathlib.Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Microsoft/Edge/Application/msedge.exe",
            pathlib.Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Microsoft/Edge/Application/msedge.exe",
            pathlib.Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Google/Chrome/Application/chrome.exe",
            pathlib.Path(os.environ.get("LOCALAPPDATA", "")) / "Google/Chrome/Application/chrome.exe",
        ]
        profile = config.DATA_DIR / "browser-profile"
        profile.mkdir(parents=True, exist_ok=True)
        for browser in candidates:
            if browser.exists():
                try:
                    subprocess.Popen([
                        str(browser),
                        f"--app={url}",
                        f"--user-data-dir={profile}",
                        "--window-size=1480,940",
                        "--no-first-run",
                        "--no-default-browser-check",
                    ], creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                    return
                except OSError:
                    continue
    try:
        webbrowser.open(url, new=2)
    except Exception:
        pass


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=f"{config.APP_NAME} - {config.APP_TAGLINE}")
    parser.add_argument("--host", default=config.DEFAULT_HOST, help="Dinlenecek adres (varsayılan 127.0.0.1)")
    parser.add_argument("--port", type=int, default=config.DEFAULT_PORT, help="Tercih edilen HTTP portu")
    parser.add_argument("--data", default="", help="Veri dizini (varsayılan: ./data)")
    parser.add_argument("--no-browser", action="store_true", help="Arayüzü otomatik açma")
    parser.add_argument("--tab", action="store_true", help="Uygulama penceresi yerine normal sekmede aç")
    parser.add_argument("--debug", action="store_true", help="Ayrıntılı HTTP logları")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.data:
        os.environ["CRAFTDECK_DATA"] = str(pathlib.Path(args.data).expanduser().resolve())
        import importlib

        importlib.reload(config)
    if args.debug:
        os.environ["CRAFTDECK_DEBUG"] = "1"

    config.ensure_dirs()
    print(BANNER)
    print(f"  {config.APP_NAME} {config.APP_VERSION} — {config.APP_TAGLINE}")
    print(f"  Veri dizini: {config.DATA_DIR}")

    store = Store()
    jobs = JobManager()
    modrinth = Modrinth()
    servers = ServerManager(store, jobs, modrinth)
    ctx = AppContext(store, jobs, modrinth, servers)

    port = _pick_port(args.host, args.port)
    httpd = make_server(args.host, port, ctx)
    ctx.httpd = httpd
    url = f"http://{args.host}:{port}"
    print(f"  Arayüz: {url}")
    print("  Kapatmak için bu pencerede Ctrl+C kullanın.\n")

    try:
        config.INSTANCE_FILE.write_text(json.dumps({
            "pid": os.getpid(), "host": args.host, "port": port, "url": url,
            "started_at": now_iso(),
        }, indent=2), encoding="utf-8")
    except OSError:
        pass

    cleaned = {"done": False}

    def cleanup() -> None:
        if cleaned["done"]:
            return
        cleaned["done"] = True
        print("  Sunucular ve tüneller kapatılıyor…")
        try:
            servers.shutdown_all()
        except Exception:
            pass
        try:
            config.INSTANCE_FILE.unlink(missing_ok=True)
        except OSError:
            pass

    atexit.register(cleanup)

    if not args.no_browser:
        threading.Timer(0.7, lambda: _open_ui(url, app_window=not args.tab)).start()

    try:
        httpd.serve_forever(poll_interval=0.4)
    except KeyboardInterrupt:
        print("\n  Kapatılıyor…")
    finally:
        try:
            httpd.server_close()
        except Exception:
            pass
        cleanup()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
