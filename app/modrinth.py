from __future__ import annotations

import pathlib
import threading
import time
import urllib.parse
from typing import Any, Iterable

from . import config
from .util import ApiError, AppError, http_json

SERVER_TYPES = {"modpack", "mod", "plugin", "datapack", "shader", "resourcepack"}
MOD_LOADERS = {"fabric", "forge", "neoforge", "quilt"}
PLUGIN_LOADERS = {"paper", "purpur", "spigot", "bukkit", "folia"}

TYPE_DIRS = {
    "mod": "mods",
    "plugin": "plugins",
    "resourcepack": "resourcepacks",
    "shader": "shaderpacks",
}

_JSON_QUOTE = '"%s"'


def _quote_list(values: Iterable[str]) -> str:
    return "[" + ",".join(_JSON_QUOTE % v.replace('"', '\\"') for v in values) + "]"


class Modrinth:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._cache: dict[str, tuple[float, Any]] = {}
        self._project_cache: dict[str, dict[str, Any]] = {}
        self._version_cache: dict[str, dict[str, Any]] = {}

    def _cached(self, key: str, ttl: float, factory):
        now = time.time()
        with self._lock:
            hit = self._cache.get(key)
            if hit and now - hit[0] < ttl:
                return hit[1]
        value = factory()
        with self._lock:
            self._cache[key] = (time.time(), value)
        return value

    def tags(self) -> dict[str, Any]:
        def fetch() -> dict[str, Any]:
            versions = http_json(f"{config.MODRINTH_API}/tag/game_version")
            loaders = http_json(f"{config.MODRINTH_API}/tag/loader")
            categories = http_json(f"{config.MODRINTH_API}/tag/category")
            releases = [
                {"id": v["version"], "type": v["version_type"], "major": v.get("major", False)}
                for v in versions
                if v["version_type"] in {"release", "snapshot"}
            ]
            return {
                "game_versions": releases,
                "loaders": loaders,
                "categories": categories,
            }

        return self._cached("tags", 600, fetch)

    def game_versions(self, *, include_snapshots: bool = False) -> list[dict[str, Any]]:
        versions = self.tags()["game_versions"]
        result = [v for v in versions if v["type"] == "release"]
        if include_snapshots:
            result += [v for v in versions if v["type"] == "snapshot"][:15]
        return result

    def loader_names(self) -> list[dict[str, Any]]:
        return self.tags()["loaders"]

    def search(self, query: str = "", project_type: str = "", loader: str = "",
               game_version: str = "", *, index: str = "relevance", offset: int = 0,
               limit: int = 24) -> dict[str, Any]:
        facets: list[list[str]] = []
        if project_type:
            if project_type not in config.MODRINTH_TYPES:
                raise AppError(f"Geçersiz proje türü: {project_type}")
            facets.append([f"project_type:{project_type}"])
        if loader and loader not in {"vanilla"}:
            facets.append([f"categories:{loader}"])
        if game_version:
            facets.append([f"versions:{game_version}"])
        params: dict[str, str] = {
            "query": query.strip() or "",
            "index": index if index in {"relevance", "downloads", "follows", "newest", "updated"} else "relevance",
            "offset": str(max(0, int(offset))),
            "limit": str(max(1, min(50, int(limit)))),
        }
        if facets:
            params["facets"] = "[" + ",".join(
                "[" + ",".join('"%s"' % item for item in group) + "]" for group in facets
            ) + "]"
        url = f"{config.MODRINTH_API}/search?" + urllib.parse.urlencode(params)
        data = http_json(url)
        hits = [
            {
                "id": hit.get("project_id"),
                "slug": hit.get("slug"),
                "title": hit.get("title"),
                "description": hit.get("description"),
                "author": hit.get("author"),
                "type": hit.get("project_type"),
                "categories": hit.get("categories") or [],
                "display_categories": hit.get("display_categories") or hit.get("categories") or [],
                "downloads": hit.get("downloads", 0),
                "follows": hit.get("follows", 0),
                "icon_url": hit.get("icon_url"),
                "versions": (hit.get("versions") or [])[-6:],
                "client_side": hit.get("client_side"),
                "server_side": hit.get("server_side"),
                "date_modified": hit.get("date_modified"),
                "date_created": hit.get("date_created"),
                "license": hit.get("license"),
                "color": hit.get("color"),
            }
            for hit in (data.get("hits") or [])
        ]
        for hit in hits:
            if hit["id"]:
                self._project_cache[hit["id"]] = hit
        return {
            "hits": hits,
            "offset": data.get("offset", 0),
            "limit": data.get("limit", limit),
            "total_hits": data.get("total_hits", 0),
        }

    def project(self, project_id: str) -> dict[str, Any]:
        with self._lock:
            if project_id in self._project_cache and self._project_cache[project_id].get("body"):
                return dict(self._project_cache[project_id])
        data = http_json(f"{config.MODRINTH_API}/project/{urllib.parse.quote(project_id)}")
        normalized = {
            "id": data.get("id"),
            "slug": data.get("slug"),
            "title": data.get("title"),
            "description": data.get("description"),
            "body": data.get("body") or "",
            "type": data.get("project_type"),
            "categories": data.get("categories") or [],
            "downloads": data.get("downloads", 0),
            "follows": data.get("follows", 0),
            "icon_url": data.get("icon_url"),
            "gallery": [
                {
                    "url": (img.get("url") or ""),
                    "featured": img.get("featured", False),
                    "title": img.get("title", ""),
                }
                for img in (data.get("gallery") or [])[:8]
            ],
            "game_versions": data.get("game_versions") or [],
            "loaders": data.get("loaders") or [],
            "client_side": data.get("client_side"),
            "server_side": data.get("server_side"),
            "license": (data.get("license") or {}).get("id", ""),
            "source_url": data.get("source_url"),
            "issues_url": data.get("issues_url"),
            "date_modified": data.get("updated"),
            "team": data.get("team"),
        }
        with self._lock:
            self._project_cache[project_id] = {**self._project_cache.get(project_id, {}), **normalized}
        return normalized

    def versions(self, project_id: str, *, loader: str = "", game_version: str = "") -> list[dict[str, Any]]:
        params: dict[str, str] = {}
        if loader and loader not in {"vanilla"}:
            params["loaders"] = _quote_list([loader])
        if game_version:
            params["game_versions"] = _quote_list([game_version])
        url = f"{config.MODRINTH_API}/project/{urllib.parse.quote(project_id)}/version"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        data = http_json(url)
        versions = [self._normalize_version(v) for v in data]
        versions.sort(key=lambda v: (v["version_type"] == "release", v["date_published"]), reverse=True)
        for version in versions:
            with self._lock:
                self._version_cache[version["id"]] = version
        return versions

    def version(self, version_id: str) -> dict[str, Any]:
        with self._lock:
            if version_id in self._version_cache:
                return dict(self._version_cache[version_id])
        data = http_json(f"{config.MODRINTH_API}/version/{urllib.parse.quote(version_id)}")
        version = self._normalize_version(data)
        with self._lock:
            self._version_cache[version_id] = version
        return version

    @staticmethod
    def _normalize_version(data: dict[str, Any]) -> dict[str, Any]:
        files = []
        for f in data.get("files") or []:
            files.append({
                "filename": f.get("filename"),
                "url": f.get("url"),
                "primary": bool(f.get("primary")),
                "size": f.get("size", 0),
                "hashes": f.get("hashes") or {},
            })
        if files:
            files.sort(key=lambda f: (not f["primary"], f["size"]))
        return {
            "id": data.get("id"),
            "project_id": data.get("project_id"),
            "name": data.get("name"),
            "version_number": data.get("version_number"),
            "version_type": data.get("version_type", "release"),
            "game_versions": data.get("game_versions") or [],
            "loaders": data.get("loaders") or [],
            "date_published": data.get("date_published", ""),
            "downloads": data.get("downloads", 0),
            "files": files,
            "dependencies": [
                {
                    "version_id": d.get("version_id"),
                    "project_id": d.get("project_id"),
                    "file_name": d.get("file_name"),
                    "dependency_type": d.get("dependency_type", "required"),
                }
                for d in (data.get("dependencies") or [])
            ],
            "changelog": data.get("changelog") or "",
        }

    def pick_version(self, project_id: str, *, loader: str = "", game_version: str = "") -> dict[str, Any]:
        versions = self.versions(project_id, loader=loader, game_version=game_version)
        if not versions:
            project = self.project(project_id)
            extra = []
            if game_version:
                extra.append(f"Minecraft {game_version}")
            if loader:
                extra.append(loader.capitalize())
            wanted = " + ".join(extra) or "sürüm"
            raise AppError(
                f"'{project.get('title')}' için {wanted} uyumlu sürüm bulunamadı.",
                detail="Modrinth'te bu filtreyle yayınlanmış bir dosya yok. Farklı bir sürüm/yükleyici seçin.",
            )
        return versions[0]

    def compatible_version(self, project_id: str, *, loader: str = "", game_version: str = "") -> dict[str, Any] | None:
        try:
            return self.pick_version(project_id, loader=loader, game_version=game_version)
        except AppError:
            return None

    def resolve_dependencies(self, version: dict[str, Any], *, loader: str, game_version: str,
                             max_depth: int = 6) -> tuple[list[dict[str, Any]], list[str]]:
        resolved: list[dict[str, Any]] = []
        warnings: list[str] = []
        seen_projects: set[str] = {version.get("project_id") or ""}
        queue: list[tuple[dict[str, Any], int]] = [(dep, 1) for dep in version.get("dependencies", [])
                                                   if dep.get("dependency_type") == "required"]
        while queue:
            dep, depth = queue.pop(0)
            if depth > max_depth:
                continue
            project_id = dep.get("project_id")
            if not project_id or project_id in seen_projects:
                continue
            seen_projects.add(project_id)
            dep_version: dict[str, Any] | None = None
            try:
                if dep.get("version_id"):
                    dep_version = self.version(dep["version_id"])
                project = self.project(project_id)
                if dep_version is None:
                    dep_version = self.compatible_version(project_id, loader=loader, game_version=game_version)
                if dep_version is None:
                    warnings.append(f"{project.get('title') or project_id}: uyumlu bağımlılık sürümü bulunamadı")
                    continue
                primary = self.primary_file(dep_version)
                if not primary:
                    warnings.append(f"{project.get('title') or project_id}: indirilebilir dosya yok")
                    continue
                resolved.append({"project": project, "version": dep_version, "file": primary})
                for child in dep_version.get("dependencies", []):
                    if child.get("dependency_type") == "required":
                        queue.append((child, depth + 1))
            except (ApiError, AppError) as exc:
                warnings.append(f"Bağımlılık çözülemedi: {exc}")
        return resolved, warnings

    @staticmethod
    def primary_file(version: dict[str, Any]) -> dict[str, Any] | None:
        files = version.get("files") or []
        if not files:
            return None
        for file in files:
            if file.get("primary"):
                return file
        return files[0]

    def content_dir_for(self, project_type: str) -> str:
        if project_type not in TYPE_DIRS:
            raise AppError(f"'{project_type}' türü doğrudan sunucuya kurulamaz.")
        return TYPE_DIRS[project_type]

    def check_server_compat(self, project: dict[str, Any], loader: str) -> str | None:
        ptype = project.get("type")
        if ptype in {"shader", "resourcepack"}:
            return "İstemci tarafı içerik sunucuya kurulabilir ancak oyuncuların görmesi için istemcilerine de kurulmalı."
        if project.get("server_side") == "unsupported" and ptype in {"mod", "plugin"}:
            return f"{project.get('title')} yalnızca istemci tarafında çalışır (server_side: unsupported)."
        return None


def is_client_only(project: dict[str, Any]) -> bool:
    return project.get("server_side") == "unsupported"


def icon_for(project: dict[str, Any]) -> str:
    return project.get("icon_url") or ""


def local_icon(project_id: str) -> pathlib.Path | None:
    path = config.CACHE_DIR / "icons" / f"{project_id}.png"
    return path if path.exists() else None
