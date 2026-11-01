from __future__ import annotations

import pathlib
import re
import subprocess
import threading
import time
import urllib.parse
import xml.etree.ElementTree as ET
from typing import Any, Callable

from . import config
from .util import ApiError, AppError, download_file, http_get_text, http_json

LogFn = Callable[[str], None]
ProgressFn = Callable[[float, str], None]

_META_CACHE: dict[str, tuple[float, Any]] = {}
_META_LOCK = threading.RLock()


def _meta(key: str, ttl: float, factory: Callable[[], Any]) -> Any:
    now = time.time()
    with _META_LOCK:
        hit = _META_CACHE.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    value = factory()
    with _META_LOCK:
        _META_CACHE[key] = (time.time(), value)
    return value


def _creation_flags() -> int:
    if config.IS_WINDOWS:
        return getattr(subprocess, "CREATE_NO_WINDOW", 0)
    return 0


def run_streamed(cmd: list[str], cwd: pathlib.Path, log: LogFn, *,
                 timeout: float | None = None, env: dict[str, str] | None = None) -> None:
    log("$ " + " ".join(str(part) for part in cmd))
    proc = subprocess.Popen(
        cmd, cwd=str(cwd), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL, text=True, encoding="utf-8", errors="replace",
        env=env, creationflags=_creation_flags(),
    )
    tail: list[str] = []
    started = time.time()
    assert proc.stdout is not None
    try:
        for line in proc.stdout:
            text = line.rstrip()
            if text:
                log(text)
                tail.append(text)
                if len(tail) > 40:
                    tail.pop(0)
            if timeout and time.time() - started > timeout:
                proc.kill()
                raise AppError("Kurulum zaman aşımına uğradı", detail="\n".join(tail[-10:]))
        code = proc.wait(timeout=120)
    finally:
        if proc.poll() is None:
            proc.kill()
    if code != 0:
        raise AppError(
            f"Kurulum komutu başarısız oldu (çıkış kodu {code})",
            detail="\n".join(tail[-12:]) or "Ayrıntı yok",
        )


def _download(url: str, dest: pathlib.Path, log: LogFn, progress: ProgressFn | None,
              *, label: str, hashes: dict[str, str] | None = None,
              pct_from: float = 0.0, pct_to: float = 100.0) -> pathlib.Path:
    dest = pathlib.Path(dest)
    if dest.exists() and dest.stat().st_size > 1024:
        log(f"✓ Önbellekte mevcut: {dest.name}")
        if progress:
            progress(pct_to, f"{label} hazır")
        return dest
    log(f"↓ {label} indiriliyor…")
    total_holder = {"total": 0}

    def on_progress(done: int, total: int) -> None:
        total_holder["total"] = total
        if not progress:
            return
        ratio = (done / total) if total else 0.0
        pct = pct_from + (pct_to - pct_from) * max(0.0, min(1.0, ratio))
        progress(pct, f"{label} %{int(ratio * 100) if total else 0}")

    return download_file(url, dest, hashes=hashes, progress=on_progress, timeout=90, retries=3)


def fabric_loaders(mc_version: str) -> list[dict[str, Any]]:
    url = f"https://meta.fabricmc.net/v2/versions/loader/{urllib.parse.quote(mc_version)}"
    try:
        return http_json(url, retries=2)
    except ApiError as exc:
        raise AppError(f"Fabric, Minecraft {mc_version} sürümünü desteklemiyor", detail=str(exc)) from exc


def install_fabric(server_dir: pathlib.Path, mc: str, preferred: str, java: str,
                   log: LogFn, progress: ProgressFn | None) -> dict[str, Any]:
    loaders = fabric_loaders(mc)
    if not loaders:
        raise AppError(f"Fabric {mc} için yükleyici sürümü bulunamadı")
    versions = [(item.get("loader") or {}) for item in loaders]
    chosen = None
    if preferred:
        chosen = next((v for v in versions if v.get("version") == preferred), None)
    if chosen is None:
        chosen = next((v for v in versions if v.get("stable")), versions[0])
    loader_version = chosen.get("version")
    log(f"Fabric Loader {loader_version} seçildi")

    installers = http_json("https://meta.fabricmc.net/v2/versions/installer")
    if not installers:
        raise AppError("Fabric installer sürümü alınamadı")
    installer = installers[0]
    installer_jar = _download(
        installer["url"], config.CACHE_DIR / f"fabric-installer-{installer['version']}.jar",
        log, progress, label=f"Fabric Installer {installer['version']}",
        pct_from=5, pct_to=20,
    )
    if progress:
        progress(25, "Fabric sunucusu kuruluyor")
    run_streamed([
        java, "-jar", str(installer_jar), "server",
        "-mcversion", mc, "-loader", loader_version,
        "-downloadMinecraft", "-dir", str(server_dir),
    ], server_dir, log, timeout=900)
    if not (server_dir / "fabric-server-launch.jar").exists():
        raise AppError("Fabric kurulumu tamamlanmadı (fabric-server-launch.jar yok)")
    return {
        "loader": "fabric",
        "loader_version": loader_version,
        "jar": "fabric-server-launch.jar",
        "args": ["-jar", "fabric-server-launch.jar", "nogui"],
    }


def install_quilt(server_dir: pathlib.Path, mc: str, preferred: str, java: str,
                  log: LogFn, progress: ProgressFn | None) -> dict[str, Any]:
    try:
        loaders = http_json(f"https://meta.quiltmc.org/v3/versions/loader/{urllib.parse.quote(mc)}", retries=2)
    except ApiError as exc:
        raise AppError(f"Quilt, Minecraft {mc} sürümünü desteklemiyor (deneysel)", detail=str(exc)) from exc
    if not loaders:
        raise AppError(f"Quilt {mc} için yükleyici bulamadı")
    versions = [(item.get("loader") or {}) for item in loaders]
    chosen = next((v for v in versions if v.get("version") == preferred), versions[0]) if preferred else versions[0]
    loader_version = chosen.get("version")
    installers = http_json("https://meta.quiltmc.org/v3/versions/installer")
    installer = installers[0]
    installer_jar = _download(
        installer["url"], config.CACHE_DIR / f"quilt-installer-{installer['version']}.jar",
        log, progress, label=f"Quilt Installer {installer['version']}", pct_from=5, pct_to=20,
    )
    if progress:
        progress(25, "Quilt sunucusu kuruluyor")
    run_streamed([
        java, "-jar", str(installer_jar), "install", "server", mc, loader_version,
        "--download-server", f"--install-dir={server_dir}",
    ], server_dir, log, timeout=900)
    if not (server_dir / "quilt-server-launch.jar").exists():
        raise AppError("Quilt kurulumu tamamlanmadı (quilt-server-launch.jar yok)")
    return {
        "loader": "quilt",
        "loader_version": loader_version,
        "jar": "quilt-server-launch.jar",
        "args": ["-jar", "quilt-server-launch.jar", "nogui"],
        "note": "Quilt desteği deneyseldir.",
    }


def forge_version(mc: str) -> str:
    promos = http_json("https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json")
    table = (promos or {}).get("promos") or {}
    for suffix in ("recommended", "latest"):
        value = table.get(f"{mc}-{suffix}")
        if value:
            return str(value)
    raise AppError(f"Forge, Minecraft {mc} sürümü için yayınlanmamış", detail="Farklı bir sürüm veya NeoForge deneyin.")


def install_forge(server_dir: pathlib.Path, mc: str, preferred: str, java: str,
                  log: LogFn, progress: ProgressFn | None) -> dict[str, Any]:
    version = preferred or forge_version(mc)
    log(f"Forge {version} (MC {mc}) kurulacak")
    coord = f"{mc}-{version}"
    installer_url = (
        "https://maven.minecraftforge.net/net/minecraftforge/forge/"
        f"{coord}/forge-{coord}-installer.jar"
    )
    installer = _download(
        installer_url, config.CACHE_DIR / f"forge-{coord}-installer.jar",
        log, progress, label=f"Forge {version} installer", pct_from=5, pct_to=25,
    )
    if progress:
        progress(30, "Forge sunucu dosyaları kuruluyor (uzun sürebilir)")
    run_streamed([java, "-jar", str(installer), "--installServer"], server_dir, log, timeout=1800)

    args_pattern = "win_args.txt" if config.IS_WINDOWS else "unix_args.txt"
    args_files = sorted(server_dir.glob(f"libraries/net/minecraftforge/forge/{coord}/{args_pattern}"))
    if not args_files:
        args_files = sorted(server_dir.glob(f"libraries/net/minecraftforge/forge/*/{args_pattern}"))
    if not args_files:
        raise AppError("Forge kurulum dosyaları oluşmadı", detail="installer loglarını inceleyin.")
    args_file = args_files[-1].relative_to(server_dir).as_posix()
    _write_user_jvm_args(server_dir, 1024, 2048, "")
    return {
        "loader": "forge",
        "loader_version": version,
        "jar": "",
        "args": ["@user_jvm_args.txt", f"@{args_file}", "nogui"],
        "args_file": args_file,
    }


def neoforge_versions(mc: str) -> list[str]:
    data = http_json("https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge")
    all_versions = [str(v) for v in (data or {}).get("versions", [])]
    if mc == "1.20.1":
        prefix = "47."
    elif mc.startswith("1."):
        prefix = mc[2:] + "."
    else:
        prefix = mc + "."
    matched = [v for v in all_versions if v.startswith(prefix)]
    if not matched:
        raise AppError(f"NeoForge, Minecraft {mc} için bulunamadı",
                       detail="NeoForge 1.20.1 için resmi destek yoktur; Forge kullanın.")
    def sort_key(value: str):
        return tuple(int(p) if p.isdigit() else p for p in re.split(r"[.\-+]", value))

    matched.sort(key=sort_key)
    return matched


def install_neoforge(server_dir: pathlib.Path, mc: str, preferred: str, java: str,
                     log: LogFn, progress: ProgressFn | None) -> dict[str, Any]:
    versions = neoforge_versions(mc)
    version = preferred if preferred in versions else versions[-1]
    log(f"NeoForge {version} (MC {mc}) kurulacak")
    installer_url = (
        "https://maven.neoforged.net/releases/net/neoforged/neoforge/"
        f"{version}/neoforge-{version}-installer.jar"
    )
    installer = _download(
        installer_url, config.CACHE_DIR / f"neoforge-{version}-installer.jar",
        log, progress, label=f"NeoForge {version} installer", pct_from=5, pct_to=25,
    )
    if progress:
        progress(30, "NeoForge sunucu dosyaları kuruluyor (uzun sürebilir)")
    run_streamed([java, "-jar", str(installer), "--installServer"], server_dir, log, timeout=1800)

    args_pattern = "win_args.txt" if config.IS_WINDOWS else "unix_args.txt"
    args_files = sorted(server_dir.glob(f"libraries/net/neoforged/neoforge/{version}/{args_pattern}"))
    if not args_files:
        args_files = sorted(server_dir.glob(f"libraries/net/neoforged/neoforge/*/{args_pattern}"))
    if not args_files:
        raise AppError("NeoForge kurulum dosyaları oluşmadı", detail="installer loglarını inceleyin.")
    args_file = args_files[-1].relative_to(server_dir).as_posix()
    _write_user_jvm_args(server_dir, 1024, 2048, "")
    return {
        "loader": "neoforge",
        "loader_version": version,
        "jar": "",
        "args": ["@user_jvm_args.txt", f"@{args_file}", "nogui"],
        "args_file": args_file,
    }


def paper_versions() -> dict[str, list[str]]:
    def fetch() -> dict[str, list[str]]:
        data = http_json("https://fill.papermc.io/v3/projects/paper/versions")
        entries = data.get("versions") or []
        if isinstance(entries, dict):
            return {k: list(v) for k, v in entries.items()}
        ids: list[str] = []
        for entry in entries:
            if isinstance(entry, dict):
                version = entry.get("version")
                value = version.get("id") if isinstance(version, dict) else version
            else:
                value = entry
            if value:
                ids.append(str(value))
        return {"versions": ids}

    return _meta("paper_versions", 300, fetch)


def install_paper(server_dir: pathlib.Path, mc: str, preferred: str, java: str,
                  log: LogFn, progress: ProgressFn | None) -> dict[str, Any]:
    versions = paper_versions()
    available = {v for group in versions.values() for v in group}
    if mc not in available:
        raise AppError(f"Paper, Minecraft {mc} için yayınlanmamış", detail="Purpur veya Vanilla deneyin.")
    builds = http_json(
        "https://fill.papermc.io/v3/projects/paper/versions/"
        f"{urllib.parse.quote(mc)}/builds"
    )
    if not builds:
        raise AppError(f"Paper {mc} için build bulunamadı")
    stable = [b for b in builds if str(b.get("channel", "")).upper() == "STABLE"]
    build = (stable or builds)[0]
    downloads = build.get("downloads") or {}
    download = downloads.get("server:default") or next(iter(downloads.values()), None)
    if not download or not download.get("url"):
        raise AppError("Paper indirme bağlantısı alınamadı")
    filename = download.get("name") or f"paper-{mc}-{build.get('id', 'latest')}.jar"
    target = server_dir / filename
    hashes = (download.get("checksums") or {})
    _download(download["url"], target, log, progress, label=filename,
              hashes={k: v for k, v in hashes.items() if k in {"sha256", "sha1"}} or None,
              pct_from=10, pct_to=95)
    return {
        "loader": "paper",
        "loader_version": f"build {build.get('id')}",
        "jar": filename,
        "args": ["-jar", filename, "nogui"],
    }


def install_purpur(server_dir: pathlib.Path, mc: str, preferred: str, java: str,
                   log: LogFn, progress: ProgressFn | None) -> dict[str, Any]:
    data = http_json("https://api.purpurmc.org/v2/purpur")
    versions = data.get("versions") or []
    if mc not in versions:
        raise AppError(f"Purpur, Minecraft {mc} için yayınlanmamış", detail="Paper veya Vanilla deneyin.")
    latest = http_json(f"https://api.purpurmc.org/v2/purpur/{urllib.parse.quote(mc)}/latest")
    build = str(latest.get("build") or "latest")
    filename = f"purpur-{mc}-{build}.jar"
    _download(
        f"https://api.purpurmc.org/v2/purpur/{urllib.parse.quote(mc)}/latest/download",
        server_dir / filename, log, progress, label=filename, pct_from=10, pct_to=95,
    )
    return {
        "loader": "purpur",
        "loader_version": f"build {build}",
        "jar": filename,
        "args": ["-jar", filename, "nogui"],
    }


def install_vanilla(server_dir: pathlib.Path, mc: str, preferred: str, java: str,
                    log: LogFn, progress: ProgressFn | None) -> dict[str, Any]:
    manifest = _meta("mojang_manifest", 300, lambda: http_json(
        "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json"
    ))
    entry = next((v for v in (manifest or {}).get("versions", []) if v.get("id") == mc), None)
    if not entry:
        raise AppError(f"Minecraft {mc} resmi sürüm listesinde yok")
    detail = http_json(entry["url"])
    server = (detail.get("downloads") or {}).get("server")
    if not server:
        raise AppError(f"Minecraft {mc} için sunucu dosyası yayınlanmamış (snapshot olabilir)")
    _download(server["url"], server_dir / "server.jar", log, progress,
              label=f"Vanilla {mc} server.jar",
              hashes={"sha1": server.get("sha1", "")} if server.get("sha1") else None,
              pct_from=10, pct_to=95)
    return {
        "loader": "vanilla",
        "loader_version": "",
        "jar": "server.jar",
        "args": ["-jar", "server.jar", "nogui"],
    }


def _write_user_jvm_args(server_dir: pathlib.Path, ram_min: int, ram_max: int, extra: str) -> None:
    lines = [f"-Xms{max(256, int(ram_min))}M", f"-Xmx{max(512, int(ram_max))}M"]
    if extra.strip():
        lines.append(extra.strip())
    (server_dir / "user_jvm_args.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


INSTALLERS = {
    "fabric": install_fabric,
    "quilt": install_quilt,
    "forge": install_forge,
    "neoforge": install_neoforge,
    "paper": install_paper,
    "purpur": install_purpur,
    "vanilla": install_vanilla,
}


def install_engine(server_dir: pathlib.Path, mc: str, loader: str, java: str, *,
                   log: LogFn, progress: ProgressFn | None = None,
                   preferred_version: str = "") -> dict[str, Any]:
    if loader not in INSTALLERS:
        raise AppError(f"Bilinmeyen sunucu motoru: {loader}")
    if not java:
        raise AppError("Java yolu belirtilmedi", detail="Ayarlar > Java bölümünden bir Java seçin.")
    server_dir = pathlib.Path(server_dir)
    server_dir.mkdir(parents=True, exist_ok=True)
    if progress:
        progress(2, f"{loader.capitalize()} hazırlanıyor")
    info = INSTALLERS[loader](server_dir, mc, preferred_version, java, log, progress)
    info.update({"mc_version": mc, "installed_at": str(int(time.time())), "java": java})
    if progress:
        progress(100, "Motor kuruldu")
    return info


def write_engine_info(server_dir: pathlib.Path, info: dict[str, Any]) -> None:
    import json

    (server_dir / "craftdeck-engine.json").write_text(
        json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def read_engine_info(server_dir: pathlib.Path) -> dict[str, Any] | None:
    import json

    path = pathlib.Path(server_dir) / "craftdeck-engine.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
