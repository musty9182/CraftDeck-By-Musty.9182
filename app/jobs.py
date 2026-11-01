from __future__ import annotations

import secrets
import threading
import time
import traceback
from typing import Any, Callable

from .store import now_iso


class Job:
    def __init__(self, title: str, kind: str = "task") -> None:
        self.id = "job_" + secrets.token_hex(5)
        self.title = title
        self.kind = kind
        self.status = "queued"
        self.progress = 0.0
        self.message = "Sırada bekliyor"
        self.logs: list[dict[str, Any]] = []
        self.created_at = now_iso()
        self.started_at = ""
        self.finished_at = ""
        self.error = ""
        self._lock = threading.RLock()
        self._cancel = threading.Event()

    def log(self, text: str, stream: str = "info") -> None:
        line = str(text).rstrip()
        if not line:
            return
        with self._lock:
            self.logs.append({"t": time.time(), "stream": stream, "text": line})
            if len(self.logs) > 600:
                del self.logs[: len(self.logs) - 600]
            self.message = line[-300:]

    def set_progress(self, value: float, message: str | None = None) -> None:
        with self._lock:
            self.progress = max(0.0, min(100.0, float(value)))
            if message:
                self.message = message

    def cancel(self) -> None:
        self._cancel.set()

    @property
    def cancelled(self) -> bool:
        return self._cancel.is_set()

    def snapshot(self, *, logs: bool = True, since: int = 0) -> dict[str, Any]:
        with self._lock:
            data: dict[str, Any] = {
                "id": self.id,
                "title": self.title,
                "kind": self.kind,
                "status": self.status,
                "progress": round(self.progress, 1),
                "message": self.message,
                "created_at": self.created_at,
                "started_at": self.started_at,
                "finished_at": self.finished_at,
                "error": self.error,
            }
            if logs:
                data["logs"] = self.logs[since:]
                data["log_count"] = len(self.logs)
            return data


class JobManager:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.RLock()

    def create(self, title: str, kind: str = "task") -> Job:
        job = Job(title, kind)
        with self._lock:
            self._jobs[job.id] = job
            if len(self._jobs) > 40:
                done = [j for j in self._jobs.values() if j.status in {"done", "error", "cancelled"}]
                done.sort(key=lambda j: j.created_at)
                for old in done[: max(0, len(self._jobs) - 40)]:
                    self._jobs.pop(old.id, None)
        return job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def list(self) -> list[dict[str, Any]]:
        with self._lock:
            jobs = list(self._jobs.values())
        jobs.sort(key=lambda j: j.created_at, reverse=True)
        return [j.snapshot(logs=False) for j in jobs[:15]]

    def run(self, job: Job, fn: Callable[[Job], Any]) -> Job:
        def runner() -> None:
            job.status = "running"
            job.started_at = now_iso()
            job.set_progress(1, "Başlıyor")
            job.log(f"▶ {job.title}")
            try:
                fn(job)
                if job.cancelled:
                    job.status = "cancelled"
                    job.message = "İptal edildi"
                    job.log("■ İşlem iptal edildi")
                else:
                    job.status = "done"
                    job.progress = 100.0
                    job.message = job.message or "Tamamlandı"
                    job.log("✔ Tamamlandı")
            except Exception as exc:
                job.status = "error"
                job.error = str(exc)
                job.message = getattr(exc, "message", str(exc))
                job.log(f"✖ Hata: {job.message}", "error")
                detail = getattr(exc, "detail", "")
                if detail:
                    job.log(str(detail)[:1500], "error")
                job.log(traceback.format_exc(limit=4), "error")
            finally:
                job.finished_at = now_iso()
                job.log(f"⏱ Durum: {job.status}")

        threading.Thread(target=runner, name=f"job-{job.id}", daemon=True).start()
        return job

    def active_for(self, server_id: str) -> dict[str, Any] | None:
        prefix = f"{server_id}:"
        with self._lock:
            for job in self._jobs.values():
                if job.kind.startswith(prefix) and job.status in {"queued", "running"}:
                    return job.snapshot(logs=False)
        return None
