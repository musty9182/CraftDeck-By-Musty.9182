from __future__ import annotations

import os
import pathlib
import platform
import sys

APP_NAME = "CraftDeck"
APP_VERSION = "0.1.0"
APP_TAGLINE = "Yerel Minecraft Sunucu Stüdyosu"

PACKAGE_DIR = pathlib.Path(__file__).resolve().parent
BASE_DIR = PACKAGE_DIR.parent
WEB_DIR = PACKAGE_DIR / "web"


def _resolve_data_dir() -> pathlib.Path:
    env = os.environ.get("CRAFTDECK_DATA", "").strip()
    if env:
        return pathlib.Path(env).expanduser().resolve()
    return BASE_DIR / "data"


DATA_DIR = _resolve_data_dir()
SERVERS_DIR = DATA_DIR / "servers"
CACHE_DIR = DATA_DIR / "cache"
JAVA_DIR = DATA_DIR / "java"
BIN_DIR = DATA_DIR / "bin"
UPLOAD_DIR = DATA_DIR / "uploads"
STATE_FILE = DATA_DIR / "state.json"
INSTANCE_FILE = DATA_DIR / "instance.json"

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
PORT_SCAN_RANGE = 25

USER_AGENT = f"CraftDeck/{APP_VERSION} (local desktop app; contact: craftdeck@localhost)"
MODRINTH_API = "https://api.modrinth.com/v2"

IS_WINDOWS = os.name == "nt"
IS_MAC = sys.platform == "darwin"
MACHINE = (platform.machine() or "").lower()
ARCH = "aarch64" if MACHINE in {"arm64", "aarch64"} else ("x86" if MACHINE in {"x86", "i386", "i686"} else "x64")

DEFAULT_JVM_FLAGS = [
    "-XX:+UseG1GC",
    "-XX:+ParallelRefProcEnabled",
    "-XX:MaxGCPauseMillis=200",
    "-XX:+UnlockExperimentalVMOptions",
    "-XX:+DisableExplicitGC",
    "-XX:+AlwaysPreTouch",
    "-XX:G1NewSizePercent=30",
    "-XX:G1MaxNewSizePercent=40",
    "-XX:G1HeapRegionSize=8M",
    "-XX:G1ReservePercent=20",
    "-XX:G1HeapWastePercent=5",
    "-XX:G1MixedGCCountTarget=4",
    "-XX:InitiatingHeapOccupancyPercent=15",
    "-XX:G1MixedGCLiveThresholdPercent=90",
    "-XX:G1RSetUpdatingPauseTimePercent=5",
    "-XX:SurvivorRatio=32",
    "-XX:+PerfDisableSharedMem",
    "-XX:MaxTenuringThreshold=1",
]

LOADERS = [
    {"id": "fabric", "name": "Fabric", "kind": "modded", "color": "#dbb69a"},
    {"id": "neoforge", "name": "NeoForge", "kind": "modded", "color": "#f0a23a"},
    {"id": "forge", "name": "Forge", "kind": "modded", "color": "#8a93a8"},
    {"id": "quilt", "name": "Quilt (deneysel)", "kind": "modded", "color": "#b18cff"},
    {"id": "paper", "name": "Paper", "kind": "plugin", "color": "#4aa3ff"},
    {"id": "purpur", "name": "Purpur", "kind": "plugin", "color": "#c96bff"},
    {"id": "vanilla", "name": "Vanilla", "kind": "vanilla", "color": "#7fbf6a"},
]
LOADER_IDS = {loader["id"] for loader in LOADERS}

MODRINTH_TYPES = ["modpack", "mod", "plugin", "datapack", "shader", "resourcepack"]


def ensure_dirs() -> None:
    for path in (DATA_DIR, SERVERS_DIR, CACHE_DIR, JAVA_DIR, BIN_DIR, UPLOAD_DIR):
        path.mkdir(parents=True, exist_ok=True)


def server_dir(server_id: str) -> pathlib.Path:
    return SERVERS_DIR / server_id


def public_base_url(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> str:
    return f"http://{host}:{port}"
