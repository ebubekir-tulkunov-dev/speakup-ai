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

ensure_python_venv() {
  local service_dir="$1"
  local name="$2"
  cd "$service_dir"
  if [ ! -f .venv/bin/activate ]; then
    echo "→ $name: .venv yok, oluşturuluyor..."
    python3 -m venv .venv
    # shellcheck disable=SC1091
    source .venv/bin/activate
    pip install -r requirements.txt
    deactivate
  fi
}

ensure_web_deps() {
  cd "$ROOT/apps/web"
  if [ ! -d node_modules ]; then
    echo "→ Web: node_modules yok, npm install çalıştırılıyor..."
    npm install
  fi
}

ensure_deps() {
  ensure_python_venv "$ROOT/services/api" "API"
  ensure_python_venv "$ROOT/services/ai" "AI"
  ensure_web_deps
}

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
  ensure_deps
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
  api) ensure_python_venv "$ROOT/services/api" "API"; run_api ;;
  ai) ensure_python_venv "$ROOT/services/ai" "AI"; run_ai ;;
  web) ensure_web_deps; run_web ;;
  voice) ensure_python_venv "$ROOT/services/voice" "Voice"; run_voice ;;
  seed)
    ensure_python_venv "$ROOT/services/api" "API"
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
