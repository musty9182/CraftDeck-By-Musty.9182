from __future__ import annotations

import glob
import os
import pathlib
import platform
import re
import shutil
import stat
import tarfile
import threading
import time
import zipfile
from typing import Any

from . import config
from .store import Store
from .util import ApiError, AppError, download_file

_java_exe = "java.exe" if config.IS_WINDOWS else "java"
_runtime_cache: dict[str, Any] = {"at": 0.0, "items": []}
_cache_lock = threading.Lock()


def recommended_major(mc_version: str) -> int:
    raw = (mc_version or "").strip()
    numbers = re.findall(r"\d+", raw)
    if not numbers:
        return 21
    if raw.startswith("1.") and len(numbers) >= 2:
        minor = int(numbers[1])
        patch = int(numbers[2]) if len(numbers) >= 3 else 0
        if minor > 20 or (minor == 20 and patch >= 5):
            return 21
        if minor >= 17:
            return 17
        return 8
    year = int(numbers[0])
    if year >= 25:
        return 25
    return 21


def _probe_java(path: pathlib.Path | str) -> dict[str, Any] | None:
    path = pathlib.Path(path)
    if not path.is_file():
        return None
    try:
        proc = __import__("subprocess").run(
            [str(path), "-XshowSettings:properties", "-version"],
            capture_output=True, text=True, timeout=12,
            creationflags=getattr(__import__("subprocess"), "CREATE_NO_WINDOW", 0) if config.IS_WINDOWS else 0,
        )
    except (OSError, Exception):
        return None
    output = (proc.stderr or "") + "\n" + (proc.stdout or "")
    version_match = re.search(r"java\.version\s*=\s*(\S+)", output)
    vendor_match = re.search(r"java\.vendor\s*=\s*(.+)", output)
    home_match = re.search(r"java\.home\s*=\s*(.+)", output)
    if not version_match:
        version_match = re.search(r'version "([^"]+)"', output)
    if not version_match:
        return None
    version = version_match.group(1).strip()
    major = _major_from_version(version)
    if major is None:
        return None
    return {
        "path": str(path),
        "version": version,
        "major": major,
        "vendor": (vendor_match.group(1).strip() if vendor_match else ""),
        "home": (home_match.group(1).strip() if home_match else str(path.parent.parent)),
        "source": "manual",
    }


def _major_from_version(version: str) -> int | None:
    match = re.match(r"(\d+)(?:\.(\d+))?", version)
    if not match:
        return None
    first = int(match.group(1))
    if first == 1:
        return int(match.group(2) or 0)
    return first


def _candidate_paths() -> list[pathlib.Path]:
    candidates: list[pathlib.Path] = []

    def add(value: str | os.PathLike[str]) -> None:
        if not value:
            return
        p = pathlib.Path(value)
        candidates.append(p / _java_exe if p.is_dir() else p)

    java_home = os.environ.get("JAVA_HOME", "")
    if java_home:
        add(pathlib.Path(java_home) / "bin" / _java_exe)
    which = shutil.which("java")
    if which:
        candidates.append(pathlib.Path(which))

    patterns: list[str] = []
    home = ""
    for var in ("USERPROFILE", "HOME"):
        value = os.environ.get(var, "").strip()
        if value:
            home = value
            break
    if not home:
        try:
            home = str(pathlib.Path.home())
        except (RuntimeError, OSError):
            home = ""
    if config.IS_WINDOWS:
        patterns += [
            r"C:\Program Files\Eclipse Adoptium\*\bin\java.exe",
            r"C:\Program Files\Java\*\bin\java.exe",
            r"C:\Program Files\Microsoft\jdk*\bin\java.exe",
            r"C:\Program Files\Zulu\*\bin\java.exe",
            r"C:\Program Files\BellSoft\*\bin\java.exe",
            r"C:\Program Files\Amazon Corretto\*\bin\java.exe",
            r"C:\Program Files\Semeru\*\bin\java.exe",
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\Eclipse Adoptium\*\bin\java.exe"),
        ]
        if home:
            patterns.append(str(pathlib.Path(home) / ".jdks" / "*" / "bin" / "java.exe"))
    elif config.IS_MAC:
        patterns += [
            "/Library/Java/JavaVirtualMachines/*/Contents/Home/bin/java",
            "/System/Library/Java/JavaVirtualMachines/*/Contents/Home/bin/java",
            "/opt/homebrew/opt/openjdk*/bin/java",
            "/usr/local/opt/openjdk*/bin/java",
        ]
    else:
        patterns += [
            "/usr/lib/jvm/*/bin/java",
            "/usr/java/*/bin/java",
            "/opt/java/*/bin/java",
            "/opt/*/bin/java",
            "/snap/*/current/bin/java",
        ]
    for pattern in patterns:
        candidates.extend(pathlib.Path(p) for p in glob.glob(pattern))

    if config.JAVA_DIR.exists():
        candidates.extend(config.JAVA_DIR.glob(f"**/bin/{_java_exe}"))

    seen: set[str] = set()
    unique: list[pathlib.Path] = []
    for path in candidates:
        try:
            key = str(path.resolve()).lower()
        except OSError:
            key = str(path).lower()
        if key in seen:
            continue
        seen.add(key)
        if path.is_file():
            unique.append(path)
    return unique


def detect(store: Store | None = None, *, force: bool = False) -> list[dict[str, Any]]:
    with _cache_lock:
        if not force and time.time() - _runtime_cache["at"] < 20:
            return [dict(item) for item in _runtime_cache["items"]]

    found: list[dict[str, Any]] = []
    seen: set[str] = set()
    for path in _candidate_paths():
        info = _probe_java(path)
        if not info:
            continue
        key = info["path"].lower()
        if key in seen:
            continue
        seen.add(key)
        found.append(info)
    if store is not None:
        for saved in store.get_java_runtimes():
            path = saved.get("path")
            if not path or path.lower() in seen:
                continue
            info = _probe_java(path)
            if info:
                info["source"] = saved.get("source", "auto")
                found.append(info)
                seen.add(path.lower())
    found.sort(key=lambda item: (item["major"], item["version"]), reverse=True)

    with _cache_lock:
        _runtime_cache["at"] = time.time()
        _runtime_cache["items"] = found
    return [dict(item) for item in found]


def invalidate_cache() -> None:
    with _cache_lock:
        _runtime_cache["at"] = 0.0


def resolve(javas: list[dict[str, Any]], preferred: str, required_major: int) -> dict[str, Any]:
    if preferred:
        for item in javas:
            if item["path"].lower() == preferred.lower():
                return item
        info = _probe_java(preferred)
        if info:
            return info
        raise AppError(f"Seçilen Java bulunamadı: {preferred}", detail="Ayarlar > Java bölümünden geçerli bir yol seçin.")
    suitable = [item for item in javas if item["major"] >= required_major]
    if suitable:
        suitable.sort(key=lambda item: (item["major"], item["version"]))
        return suitable[0]
    if javas:
        return max(javas, key=lambda item: item["major"])
    raise AppError(
        f"Sistemde Java bulunamadı. Bu sürüm için Java {required_major}+ gerekiyor.",
        detail="Ayarlar > Java bölümünden tek tıkla indirebilirsiniz.",
    )


def adoptium_os() -> str:
    if config.IS_WINDOWS:
        return "windows"
    if config.IS_MAC:
        return "mac"
    return "linux"


def install(store: Store, major: int, progress=None, log=None) -> dict[str, Any]:
    major = int(major)
    if major not in {8, 11, 17, 21, 25}:
        raise AppError("Desteklenmeyen Java sürümü", detail=str(major))

    def say(text: str) -> None:
        if log:
            log(text)

    url = (
        f"https://api.adoptium.net/v3/binary/latest/{major}/ga/"
        f"{adoptium_os()}/{config.ARCH}/jre/hotspot/normal/eclipse"
    )
    suffix = ".zip" if config.IS_WINDOWS else ".tar.gz"
    archive = config.CACHE_DIR / f"temurin-{major}-{adoptium_os()}-{config.ARCH}{suffix}"
    if not archive.exists() or archive.stat().st_size < 10_000_000:
        say(f"Java {major} indiriliyor… (Adoptium Temurin)")
        download_file(url, archive, timeout=120, progress=progress)
    else:
        say(f"Önbellekteki Java {major} arşivi kullanılıyor")

    target = config.JAVA_DIR / f"temurin-{major}"
    if target.exists():
        shutil.rmtree(target, ignore_errors=True)
    target.mkdir(parents=True, exist_ok=True)
    say("Arşiv çıkarılıyor…")
    if zipfile.is_zipfile(archive):
        with zipfile.ZipFile(archive) as zf:
            zf.extractall(target)
    else:
        with tarfile.open(archive, "r:gz") as tf:
            try:
                tf.extractall(target, filter="data")
            except TypeError:
                tf.extractall(target)

    binaries = list(target.glob(f"**/bin/{_java_exe}"))
    if not binaries:
        raise ApiError("Java arşivi beklenen düzende değil", detail=str(archive))
    binary = binaries[0]
    if not config.IS_WINDOWS:
        for candidate in target.glob("**/bin/*"):
            if candidate.is_file():
                candidate.chmod(candidate.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    info = _probe_java(binary)
    if not info:
        raise ApiError("İndirilen Java çalıştırılamadı", detail=str(binary))
    store.add_java_runtime(str(binary), int(info["major"]), str(info["version"]))
    invalidate_cache()
    say(f"Java {info['major']} hazır: {binary}")
    return info


def probe(path: str) -> dict[str, Any] | None:
    return _probe_java(path)


def platform_label() -> str:
    return f"{platform.system()} {platform.release()} ({config.ARCH})"
