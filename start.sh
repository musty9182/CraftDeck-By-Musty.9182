#!/usr/bin/env sh
set -e
cd "$(dirname "$0")"

if command -v python3 >/dev/null 2>&1; then
    exec python3 run.py "$@"
elif command -v python >/dev/null 2>&1; then
    exec python run.py "$@"
else
    echo "Python 3.10+ bulunamadı. https://www.python.org/downloads/" >&2
    exit 1
fi
