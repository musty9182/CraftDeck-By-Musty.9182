from __future__ import annotations

import pathlib
import re
import zipfile
from typing import Any, Callable

from .util import ApiError, AppError, download_file, extract_zip, read_json, safe_join

INDEX_NAME = "modrinth.index.json"
INDEX_FORMATS = {1}
PACK_LOADERS = {
    "fabric-loader": "fabric",
    "quilt-loader": "quilt",
    "forge": "forge",
    "neoforge": "neoforge",
}


def read_mrpack(path: pathlib.Path) -> dict[str, Any]:
    path = pathlib.Path(path)
    if not path.exists():
        raise AppError("Paket dosyası bulunamadı", detail=str(path))
    if not zipfile.is_zipfile(path):
        raise AppError("Dosya geçerli bir .mrpack (zip) arşivi değil", detail=path.name)
    try:
        with zipfile.ZipFile(path) as zf:
            names = zf.namelist()
            if INDEX_NAME not in names:
                raise AppError(
                    "Paket içinde modrinth.index.json yok",
                    detail="Dosya bozuk olabilir veya Modrinth formatında değil.",
                )
            with zf.open(INDEX_NAME) as fh:
                try:
                    index = read_json_bytes(fh.read())
                except Exception as exc:
                    raise AppError("modrinth.index.json okunamadı (bozuk JSON)", detail=str(exc)) from exc
            overrides = [n for n in names if n.startswith(("overrides/", "server-overrides/"))]
            file_count = len(index.get("files") or [])
    except zipfile.BadZipFile as exc:
        raise AppError("Zip arşivi bozuk", detail=str(exc)) from exc

    if not isinstance(index, dict):
        raise AppError("Paket indeksi geçersiz")
    fmt = index.get("formatVersion")
    if fmt not in INDEX_FORMATS:
        raise AppError(f"Desteklenmeyen .mrpack formatı: {fmt}", detail="formatVersion 1 bekleniyordu.")
    deps = index.get("dependencies") or {}
    if not isinstance(deps, dict) or "minecraft" not in deps:
        raise AppError("Paket bağımlılıklarında Minecraft sürümü yok")

    loader, loader_version = loader_from_dependencies(deps)
    return {
        "path": str(path),
        "name": index.get("name") or path.stem,
        "summary": index.get("summary") or "",
        "version_id": index.get("versionId") or "",
        "mc_version": str(deps.get("minecraft")),
        "loader": loader,
        "loader_version": loader_version,
        "dependencies": deps,
        "files": index.get("files") or [],
        "file_count": file_count,
        "override_count": len(overrides),
        "format_version": fmt,
    }


def read_json_bytes(raw: bytes) -> Any:
    import json

    return json.loads(raw.decode("utf-8"))


def loader_from_dependencies(deps: dict[str, Any]) -> tuple[str, str]:
    for key, loader in PACK_LOADERS.items():
        if key in deps and deps.get(key):
            return loader, str(deps.get(key))
    return "vanilla", ""


def _is_server_file(entry: dict[str, Any]) -> bool:
    env = entry.get("env") or {}
    if isinstance(env, dict):
        if str(env.get("server", "")).lower() == "unsupported":
            return False
    return True


def _entry_paths(entry: dict[str, Any]) -> tuple[str, list[str]]:
    path = str(entry.get("path") or "").replace("\\", "/").lstrip("/")
    if not path or path.endswith("/"):
        raise AppError("Paket dosyasında geçersiz yol", detail=str(entry.get("path")))
    downloads = [str(u) for u in (entry.get("downloads") or []) if u]
    return path, downloads


def install_files(server_dir: pathlib.Path, index: dict[str, Any], *,
                  log: Callable[[str], None], progress: Callable[[float, str], None] | None = None,
                  cancelled: Callable[[], bool] = lambda: False) -> dict[str, Any]:
    files = index.get("files") or []
    total = max(1, len(files))
    downloaded = 0
    skipped = 0
    failed: list[str] = []
    bytes_total = 0

    for position, entry in enumerate(files, start=1):
        if cancelled():
            raise AppError("Kurulum iptal edildi")
        if not isinstance(entry, dict):
            continue
        if not _is_server_file(entry):
            skipped += 1
            log(f"↷ İstemciye özel dosya atlandı: {entry.get('path')}")
            continue
        try:
            rel_path, downloads = _entry_paths(entry)
            if not downloads:
                raise AppError("İndirme bağlantısı yok")
            target = safe_join(server_dir, rel_path)
            hashes = entry.get("hashes") or {}
            expected = {k: v for k, v in hashes.items() if k in {"sha1", "sha256", "sha512", "md5"} and v}
            log(f"↓ {rel_path}")
            last_error: Exception | None = None
            for url in downloads:
                try:
                    download_file(url, target, hashes=expected or None, retries=2)
                    last_error = None
                    break
                except Exception as exc:
                    last_error = exc
                    log(f"  ! Ayna başarısız: {url}")
            if last_error:
                raise last_error
            downloaded += 1
            bytes_total += int(entry.get("fileSize") or 0)
        except Exception as exc:
            failed.append(str(entry.get("path")))
            log(f"✖ {entry.get('path')} indirilemedi: {exc}")
        if progress:
            progress(position / total * 100, f"{position}/{len(files)} dosya")
    return {"downloaded": downloaded, "skipped": skipped, "failed": failed, "bytes": bytes_total}


def extract_overrides(mrpack_path: pathlib.Path, server_dir: pathlib.Path, *,
                      log: Callable[[str], None]) -> int:
    count = 0
    with zipfile.ZipFile(mrpack_path) as zf:
        for prefix in ("overrides/", "server-overrides/"):
            members = [n for n in zf.namelist() if n.startswith(prefix) and not n.endswith("/")]
            if not members:
                continue
            log(f"📦 {prefix.rstrip('/')} → sunucu kökü ({len(members)} dosya)")
            for name in members:
                rel = name[len(prefix):]
                inner = safe_join(server_dir, rel)
                inner.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(name) as src, open(inner, "wb") as out:
                    while True:
                        chunk = src.read(1024 * 256)
                        if not chunk:
                            break
                        out.write(chunk)
                count += 1
    return count


def cleanup_client_overrides(mrpack_path: pathlib.Path) -> list[str]:
    with zipfile.ZipFile(mrpack_path) as zf:
        return [n for n in zf.namelist() if n.startswith("client-overrides/")][:5]


def suggest_server_name(pack: dict[str, Any]) -> str:
    name = re.sub(r"\s+", " ", pack.get("name") or "Modpack").strip()
    return name[:48]
