from __future__ import annotations

import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from typing import Any, Callable, Iterable

from .config import USER_AGENT

ProgressFn = Callable[[int, int], None]


class AppError(Exception):
    def __init__(self, message: str, *, status: int = 400, detail: str = "") -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.detail = detail


class ApiError(AppError):
    pass


def _request(url: str, *, method: str = "GET", data: bytes | None = None,
             headers: dict[str, str] | None = None, timeout: float = 30) -> urllib.request.Request:
    hdrs = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json, text/plain, */*",
    }
    headers = headers or {}
    hdrs.update(headers)
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    return req


def http_json(url: str, *, method: str = "GET", payload: Any = None,
              timeout: float = 30, retries: int = 3) -> Any:
    data = None
    headers: dict[str, str] = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    last_error: Exception | None = None
    for attempt in range(max(1, retries)):
        try:
            with urllib.request.urlopen(_request(url, method=method, data=data, headers=headers, timeout=timeout)) as resp:
                raw = resp.read()
                if not raw:
                    return None
                return json.loads(raw.decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body = ""
            try:
                body = exc.read().decode("utf-8", "replace")[:400]
            except Exception:
                pass
            if exc.code in (400, 401, 403, 404, 410, 422):
                raise ApiError(f"İstek reddedildi ({exc.code})", status=502,
                               detail=body or url) from exc
            last_error = exc
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
        if attempt < retries - 1:
            time.sleep(min(6, 1.5 * (attempt + 1)))
    raise ApiError("Ağ isteği başarısız oldu", status=502,
                   detail=f"{url} -> {last_error}")


def http_get_text(url: str, *, timeout: float = 30, retries: int = 3) -> str:
    last_error: Exception | None = None
    for attempt in range(max(1, retries)):
        try:
            with urllib.request.urlopen(_request(url, timeout=timeout)) as resp:
                return resp.read().decode("utf-8", "replace")
        except Exception as exc:
            last_error = exc
            if attempt < retries - 1:
                time.sleep(min(6, 1.5 * (attempt + 1)))
    raise ApiError("İçerik indirilemedi", status=502, detail=f"{url} -> {last_error}")


def hashes_for(path: pathlib.Path) -> dict[str, str]:
    sha1 = hashlib.sha1()
    sha512 = hashlib.sha512()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 512), b""):
            sha1.update(chunk)
            sha512.update(chunk)
    return {"sha1": sha1.hexdigest(), "sha512": sha512.hexdigest()}


def download_file(url: str, dest: pathlib.Path, *, hashes: dict[str, str] | None = None,
                  progress: ProgressFn | None = None, retries: int = 3,
                  timeout: float = 60) -> pathlib.Path:
    dest = pathlib.Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    last_error: Exception | None = None
    for attempt in range(max(1, retries)):
        try:
            with urllib.request.urlopen(_request(url, timeout=timeout)) as resp:
                total = int(resp.headers.get("Content-Length") or 0)
                done = 0
                digesters = {
                    "sha1": hashlib.sha1(),
                    "sha256": hashlib.sha256(),
                    "sha512": hashlib.sha512(),
                    "md5": hashlib.md5(),
                }
                with open(part, "wb") as fh:
                    while True:
                        chunk = resp.read(1024 * 256)
                        if not chunk:
                            break
                        fh.write(chunk)
                        done += len(chunk)
                        for digester in digesters.values():
                            digester.update(chunk)
                        if progress:
                            try:
                                progress(done, total)
                            except Exception:
                                pass
            if hashes:
                for algo, expected in hashes.items():
                    digester = digesters.get(algo)
                    if digester and expected and digester.hexdigest().lower() != expected.lower():
                        raise ApiError("İndirilen dosyanın özeti doğrulanamadı",
                                       detail=f"{dest.name} ({algo})")
            os.replace(part, dest)
            return dest
        except Exception as exc:
            last_error = exc
            try:
                part.unlink(missing_ok=True)
            except OSError:
                pass
            if attempt < retries - 1:
                time.sleep(min(8, 2 * (attempt + 1)))
    if isinstance(last_error, AppError):
        raise last_error
    raise ApiError("Dosya indirilemedi", status=502,
                   detail=f"{url} -> {last_error}")


def safe_join(base: pathlib.Path, relative: str) -> pathlib.Path:
    base = pathlib.Path(base).resolve()
    candidate = (base / relative.replace("\\", "/")).resolve()
    try:
        candidate.relative_to(base)
    except ValueError as exc:
        raise AppError("Güvenlik: klasör dışına yazan bir yol tespit edildi", detail=relative) from exc
    return candidate


def extract_zip(zip_path: pathlib.Path, dest: pathlib.Path,
                members: Iterable[str | None] | None = None) -> int:
    dest.mkdir(parents=True, exist_ok=True)
    count = 0
    with zipfile.ZipFile(zip_path) as zf:
        wanted = set(members) if members is not None else None
        for info in zf.infolist():
            name = info.filename
            if wanted is not None and name not in wanted:
                continue
            if name.endswith("/"):
                continue
            normalized = name.replace("\\", "/")
            if normalized.startswith("/") or re.match(r"^[a-zA-Z]:", normalized):
                continue
            target = safe_join(dest, normalized)
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info) as src, open(target, "wb") as out:
                shutil.copyfileobj(src, out, length=1024 * 256)
            count += 1
    return count


def read_json(path: pathlib.Path, default: Any = None) -> Any:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return default
    except (json.JSONDecodeError, OSError):
        return default


def write_json(path: pathlib.Path, data: Any) -> None:
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".{os.getpid()}.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


def human_size(num: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if abs(num) < 1024 or unit == "GB":
            return f"{num:.0f} {unit}" if unit == "B" else f"{num:.1f} {unit}"
        num /= 1024
    return f"{num:.1f} GB"


def slugify(value: str, fallback: str = "sunucu") -> str:
    table = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")
    value = value.translate(table).lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return (value or fallback)[:40]


PROP_LINE_RE = re.compile(r"^\s*([^#!\s][^=:\s]*)\s*[=:]\s*(.*)$")
UNICODE_ESCAPE_RE = re.compile(r"\\u([0-9a-fA-F]{4})")


def decode_prop_value(value: str) -> str:
    def repl(match: re.Match[str]) -> str:
        return chr(int(match.group(1), 16))

    value = UNICODE_ESCAPE_RE.sub(repl, value)
    return value.replace("\\:", ":").replace("\\=", "=").replace("\\\\", "\\")


def encode_prop_value(value: str) -> str:
    out = []
    for ch in str(value):
        code = ord(ch)
        if ch in "\\:=#!":
            out.append("\\" + ch)
        elif 0x20 <= code <= 0x7E:
            out.append(ch)
        elif ch in "\t":
            out.append("\\t")
        elif ch in "\n":
            out.append("\\n")
        else:
            out.append(f"\\u{code:04x}")
    return "".join(out)


def read_properties(path: pathlib.Path) -> dict[str, str]:
    result: dict[str, str] = {}
    try:
        text = pathlib.Path(path).read_text(encoding="utf-8", errors="replace")
    except FileNotFoundError:
        return result
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith(("#", "!")):
            continue
        match = PROP_LINE_RE.match(line)
        if match:
            result[match.group(1)] = decode_prop_value(match.group(2))
    return result


def update_properties(path: pathlib.Path, updates: dict[str, Any],
                      header: str | None = None) -> dict[str, str]:
    path = pathlib.Path(path)
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except FileNotFoundError:
        lines = []
        if header:
            lines.extend(f"# {part}" for part in header.splitlines())
    if not lines and header is None:
        lines = ["# Minecraft server properties (CraftDeck tarafından yönetiliyor)"]

    pending = {str(k): str(v) for k, v in updates.items()}
    result: list[str] = []
    for line in lines:
        match = PROP_LINE_RE.match(line)
        if match and match.group(1) in pending:
            key = match.group(1)
            result.append(f"{key}={encode_prop_value(pending.pop(key))}")
        else:
            result.append(line)
    if pending:
        if result and result[-1].strip():
            result.append("")
        for key, value in pending.items():
            result.append(f"{key}={encode_prop_value(value)}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(result) + "\n", encoding="utf-8")
    return {**read_properties(path)}


def tail_file(path: pathlib.Path, max_bytes: int = 64 * 1024) -> str:
    try:
        with open(path, "rb") as fh:
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            fh.seek(max(0, size - max_bytes))
            return fh.read().decode("utf-8", "replace")
    except OSError:
        return ""


def temp_path(suffix: str = "") -> pathlib.Path:
    fd, name = tempfile.mkstemp(prefix="craftdeck-", suffix=suffix)
    os.close(fd)
    return pathlib.Path(name)


def terminate_process_tree(proc, *, timeout: float = 8.0) -> None:
    if proc is None or proc.poll() is not None:
        return
    try:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                capture_output=True, timeout=timeout,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        else:
            import signal

            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            except (ProcessLookupError, PermissionError):
                proc.terminate()
            try:
                proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    proc.kill()
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass
    try:
        proc.wait(timeout=timeout)
    except Exception:
        pass


def free_port(start: int = 4040, end: int = 4199) -> int:
    import socket

    for port in range(start, end + 1):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise AppError("Boş port bulunamadı", detail=f"{start}-{end}")


def port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.4)
        try:
            return sock.connect_ex((host, int(port))) == 0
        except OSError:
            return False
