#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
else
  echo "Uyarı: $ROOT/.env bulunamadı. cp .env.example .env yapın."
fi

run_api() {
  cd "$ROOT/services/api" && source .venv/bin/activate && uvicorn main:app --reload --port 8000
}

run_ai() {
  cd "$ROOT/services/ai" && source .venv/bin/activate && uvicorn main:app --reload --port 8001
}

run_web() {
  cd "$ROOT/apps/web" && npm run dev
}

run_voice() {
  cd "$ROOT/services/voice" && source .venv/bin/activate && python agent.py dev
}

run_all() {
  PIDS=()

  cleanup() {
    echo ""
    echo "Durduruluyor..."
    for pid in "${PIDS[@]:-}"; do
      kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null || true
  }
  trap cleanup EXIT INT TERM

  echo "API  → http://localhost:8000/docs"
  (run_api) &
  PIDS+=($!)

  echo "AI   → http://localhost:8001/docs"
  (run_ai) &
  PIDS+=($!)

  echo "Web  → http://localhost:5173"
  (run_web) &
  PIDS+=($!)

  echo ""
  echo "Hepsi ayakta. Durdurmak için Ctrl+C."
  wait
}

case "${1:-}" in
  api) run_api ;;
  ai) run_ai ;;
  web) run_web ;;
  voice) run_voice ;;
  seed)
    cd "$ROOT/services/api" && source .venv/bin/activate && PYTHONPATH=. python scripts/seed.py
    ;;
  all|"")
    run_all
    ;;
  *)
    echo "Kullanım: ./scripts/dev.sh [all|api|ai|web|voice|seed]"
    echo "  all (veya argümansız) — api + ai + web birlikte"
    exit 1
    ;;
esac
