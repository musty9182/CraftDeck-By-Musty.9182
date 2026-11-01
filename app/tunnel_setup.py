from __future__ import annotations

import getpass
import subprocess
import sys
import threading
import time
import webbrowser

from . import config, tunnel
from .store import Store
from .tunnel import CLAIM_RE
from .util import decode_process_text, terminate_process_tree


def _say(text: str = "") -> None:
    print(text, flush=True)


def _ask(prompt: str) -> str:
    try:
        return input(prompt)
    except (EOFError, KeyboardInterrupt):
        return ""


def _ask_token() -> str:
    _say()
    _say("Authtoken: https://dashboard.ngrok.com/get-started/your-authtoken")
    try:
        return getpass.getpass("ngrok authtoken (gizli): ").strip()
    except (EOFError, KeyboardInterrupt):
        return ""
    except Exception:
        return _ask("ngrok authtoken: ").strip()


def _save_preference(provider: str, token: str = "") -> None:
    store = Store()
    defaults = {"provider": provider, "ngrok_token": "", "playit_secret": ""}
    if provider == "ngrok" and token:
        defaults["ngrok_token"] = token
    store.update_settings(tunnel_defaults=defaults)
    for server in store.list_servers():
        cfg = dict(server.get("tunnel") or {})
        cfg["provider"] = provider
        if provider == "ngrok" and token:
            cfg["ngrok_token"] = token
        store.update_server(server["id"], tunnel=cfg)


def setup_ngrok() -> None:
    _say()
    _say("ngrok istemcisi indiriliyor…")
    exe = tunnel.ensure_ngrok(_say)
    try:
        result = subprocess.run([str(exe), "version"], capture_output=True, timeout=30)
        version = decode_process_text(result.stdout or result.stderr).strip().splitlines()
        if version:
            _say(f"ngrok sürümü: {version[0].strip()}")
    except Exception:
        pass
    token = _ask_token()
    if token:
        _save_preference("ngrok", token)
        _say("Authtoken CraftDeck ayarlarına kaydedildi.")
    else:
        _save_preference("ngrok")
        _say("Token girilmedi. Daha sonra uygulamadaki Tünel sekmesinden ekleyebilirsin.")


def _playit_run(exe, *args: str, timeout: float = 30) -> tuple[subprocess.CompletedProcess | None, str]:
    try:
        result = subprocess.run(
            [str(exe), *args],
            capture_output=True, timeout=timeout,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0) if config.IS_WINDOWS else 0,
        )
    except Exception as exc:
        return None, str(exc)
    return result, (decode_process_text(result.stdout) + decode_process_text(result.stderr))


def _playit_linked(exe) -> bool:
    _, text = _playit_run(exe, "status")
    return "secret configured: true" in text.lower()


def _playit_start(exe) -> None:
    _, text = _playit_run(exe, "start", timeout=60)
    for line in text.strip().splitlines():
        _say("  " + line.strip())


def setup_playit() -> None:
    _say()
    _say("Playit.gg ajanı indiriliyor…")
    exe = tunnel.ensure_playit(_say)
    _say()
    if _playit_linked(exe):
        _say("Bu bilgisayar zaten bir Playit hesabına bağlı; yeniden claim gerekmiyor.")
        _playit_start(exe)
        _save_preference("playit")
        _say()
        _say("Tünel yönlendirmesi: https://playit.gg/account/tunnels")
        _say("Panelde Minecraft Java tüneli oluşturup yerel portu sunucunun portuna ayarla.")
        return
    _say("Playit.gg hesap bağlantısı başlatılıyor…")
    kwargs = {
        "stdout": subprocess.PIPE,
        "stderr": subprocess.STDOUT,
        "stdin": subprocess.DEVNULL,
        "bufsize": 0,
        "creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0) if config.IS_WINDOWS else 0,
    }
    if not config.IS_WINDOWS:
        kwargs["start_new_session"] = True
    proc = subprocess.Popen([str(exe), "setup"], **kwargs)
    claim = {"url": ""}
    opened = {"done": False}

    def pump() -> None:
        stream = proc.stdout
        if stream is None:
            return
        for line in stream:
            text = decode_process_text(line).rstrip()
            if not text:
                continue
            _say("  " + text)
            match = CLAIM_RE.search(text)
            if match and not claim["url"]:
                claim["url"] = match.group(0)

    threading.Thread(target=pump, daemon=True).start()
    deadline = time.time() + 90
    while time.time() < deadline and proc.poll() is None:
        if claim["url"] and not opened["done"]:
            opened["done"] = True
            _say()
            _say("Bağlantı: " + claim["url"])
            try:
                webbrowser.open(claim["url"])
            except Exception:
                pass
            _say("Tarayıcıda hesabını bağla ve agent oluştur. Bu pencere otomatik devam eder.")
        time.sleep(0.3)
    if not claim["url"] and proc.poll() is None:
        _say()
        _say("Claim bağlantısı görünmedi. Tarayıcıdan https://playit.gg adresine girip tekrar dene.")
    wait_until = time.time() + 300
    try:
        while time.time() < wait_until and proc.poll() is None:
            time.sleep(1)
    except KeyboardInterrupt:
        _say("Kurulum penceresi kapatılıyor.")
    if proc.poll() is None:
        terminate_process_tree(proc)
    if _playit_linked(exe):
        _playit_start(exe)
        _say()
        _say("Playit.gg bağlantısı tamamlandı.")
    else:
        _say()
        _say("Bağlantı doğrulanamadı. playit-setup betiğini yönetici olarak çalıştırıp tekrar dene.")
    _save_preference("playit")
    _say("Tünel yönlendirmesi: https://playit.gg/account/tunnels")
    _say("Panelde Minecraft Java tüneli oluşturup yerel portu sunucunun portuna ayarla.")


def _choose(argument: str) -> str:
    mapping = {
        "1": "ngrok", "ngrok": "ngrok",
        "2": "playit", "playit": "playit", "playit.gg": "playit",
        "3": "cancel", "iptal": "cancel", "cancel": "cancel", "q": "cancel",
    }
    if argument:
        return mapping.get(argument.strip().lower(), "")
    _say("  1) ngrok        (ücretsiz hesap authtoken'ı gerekir)")
    _say("  2) Playit.gg    (ücretsiz hesap, tarayıcıdan claim)")
    _say("  3) Vazgeç")
    _say()
    for _ in range(3):
        choice = mapping.get(_ask("Seçimin [1/2]: ").strip().lower(), "")
        if choice:
            return choice
        _say("Geçersiz seçim, 1 veya 2 yaz.")
    return "cancel"


def main(argv: list[str] | None = None) -> int:
    if sys.version_info < (3, 10):
        _say("CraftDeck için Python 3.10 veya daha yeni bir sürüm gerekli.")
        return 1
    args = list(sys.argv[1:] if argv is None else argv)
    config.ensure_dirs()

    _say("=" * 58)
    _say("  CraftDeck - Tünel Kurulumu")
    _say("=" * 58)
    _say()
    _say("Bu araç, sunucunu internete açmak için kullanacağın")
    _say("tünel aracını indirir ve CraftDeck'e tanıtır.")
    _say()

    choice = _choose(args[0] if args else "")
    if choice == "cancel":
        _say("İşlem iptal edildi.")
        return 0

    try:
        if choice == "ngrok":
            setup_ngrok()
        else:
            setup_playit()
    except Exception as exc:
        message = getattr(exc, "message", str(exc))
        detail = getattr(exc, "detail", "")
        _say()
        _say(f"Hata: {message}")
        if detail:
            _say(f"Ayrıntı: {detail}")
        return 1

    _say()
    _say("Kurulum tamamlandı.")
    _say("CraftDeck açıksa kapatıp yeniden başlat; ardından sunucu > Tünel sekmesine git.")
    _ask("Kapatmak için Enter'a bas…")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
