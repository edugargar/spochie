#!/bin/bash
# Simula dos personas en dos maquinas usando la misma cuenta de Slack.
#
# Cada "maquina" es un SPOCHIE_HOME distinto: su propio demonio, su propio registro
# de sesiones y su propia identidad de Slack. No comparten nada en disco, asi que
# lo unico que las une es el hilo de Slack, igual que dos portatiles de verdad.
#
# La ficcion: la "maquina A" dice ser el usuario bot de la app. Es un id de Slack
# distinto del tuyo, que es lo unico que el descubrimiento necesita para no
# confundir un spochie propio con uno ajeno.
#
#   ./scripts/simular-dos-maquinas.sh up      levanta las dos con dos sesiones de Claude
#   ./scripts/simular-dos-maquinas.sh a "..."  habla con la sesion de la maquina A
#   ./scripts/simular-dos-maquinas.sh b "..."  habla con la sesion de la maquina B
#   ./scripts/simular-dos-maquinas.sh out a|b  ultima respuesta de esa sesion
#   ./scripts/simular-dos-maquinas.sh down    lo tira todo abajo
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LAB="${SPOCHIE_LAB:-/tmp/spochie-lab}"
TOKENS="${SPOCHIE_TOKEN_FILE:?exporta SPOCHIE_TOKEN_FILE con la ruta del JSON de tokens de tu app}"

# A finge ser el usuario bot; B eres tu.
A_USER="${SPOCHIE_A_USER:-}"
B_USER="${SPOCHIE_B_USER:-}"

maquina() { # nombre, spochie_home, slack_user_id, humano
  mkdir -p "$2"
  python3 - "$2/config.json" "$3" "$4" "$TOKENS" <<'PY'
import json,sys
json.dump({"guardian": True, "transcript": True, "human": sys.argv[3],
  "slack": {"tokenFile": sys.argv[4], "tokenKey": "userToken", "botTokenKey": "botToken",
            "userId": sys.argv[2], "pollMs": 20000}},
  open(sys.argv[1], "w"), indent=2)
PY
}

# Codigo de ejemplo: cada maquina tiene su mitad del problema y ninguna ve la del otro,
# que es la situacion que spochie existe para resolver.
fixtures() {
  mkdir -p "$LAB/repo-a/src" "$LAB/repo-b/src"
  cat > "$LAB/repo-a/src/Modal.tsx" <<'TSX'
export function Modal({ onSave, onClose }: Props) {
  return (
    <div className="modal">
      <button
        onClick={() => {
          onSave();      // no espera nada
          onClose();     // cierra al instante
        }}
      >Guardar</button>
    </div>
  );
}
TSX
  cat > "$LAB/repo-b/src/useSaveProfile.ts" <<'TS'
export function useSaveProfile() {
  const [saving, setSaving] = useState(false);
  async function save(data: Profile) {
    setSaving(true);
    try {
      await api.post("/profile", data);   // tarda ~600ms
      toast.success("Guardado");
    } catch (e) {
      toast.error("No se pudo guardar");  // no re-lanza: la promesa nunca rechaza
    } finally {
      setSaving(false);
    }
  }
  return { save, saving };
}
TS
  (cd "$LAB/repo-a" && git init -q && git add -A && git commit -qm modal && git checkout -q -b feat/modal-guardar)
  (cd "$LAB/repo-b" && git init -q && git add -A && git commit -qm hook && git checkout -q -b feat/guardar-perfil)
}

sesion() { # nombre, spochie_home, dir
  mkdir -p "$3" "$LAB/$1"
  rm -f "$LAB/$1.fifo"; mkfifo "$LAB/$1.fifo"
  nohup sh -c "exec sleep 100000 > $LAB/$1.fifo" >/dev/null 2>&1 &
  sleep 0.3
  SPOCHIE_HOME="$2" nohup sh -c "cd $3 && exec claude -p --verbose \
    --input-format stream-json --output-format stream-json \
    --settings '{\"crossSessionInbound\":\"accept\"}' \
    --dangerously-skip-permissions --name spochie-$1 \
    < $LAB/$1.fifo > $LAB/$1.out 2> $LAB/$1.err" >/dev/null 2>&1 &
}

decir() { python3 -c 'import json,sys; print(json.dumps({"type":"user","message":{"role":"user","content":sys.argv[1]}}))' "$2" > "$LAB/$1.fifo"; }

case "${1:-}" in
  up)
    [ -n "$A_USER" ] && [ -n "$B_USER" ] || { echo "Faltan SPOCHIE_A_USER y SPOCHIE_B_USER (ids de Slack)"; exit 2; }
    "$0" down >/dev/null 2>&1 || true
    rm -rf "$LAB"; mkdir -p "$LAB"
    fixtures
    maquina a "$LAB/home-a" "$A_USER" "Ana"
    maquina b "$LAB/home-b" "$B_USER" "Edu"
    sesion a "$LAB/home-a" "$LAB/repo-a"
    sesion b "$LAB/home-b" "$LAB/repo-b"
    sleep 5
    for s in a b; do
      decir $s "Ejecuta en bash y pega la salida: echo \"{\\\"session_id\\\":\\\"sim-$s\\\",\\\"cwd\\\":\\\"\$PWD\\\"}\" | bun run $ROOT/src/cli.ts register && bun run $ROOT/src/cli.ts sessions"
    done
    echo "Maquina A ($A_USER, Ana) y maquina B ($B_USER, Edu) levantadas en $LAB"
    ;;
  a|b) decir "$1" "$2" ;;
  out)
    python3 - "$LAB/${2}.out" <<'PY'
import json,sys
for line in reversed(open(sys.argv[1]).read().splitlines()):
    try: o = json.loads(line)
    except Exception: continue
    if o.get("type") == "result": print(o.get("result", "")); break
PY
    ;;
  down)
    pkill -f 'name spochie-a' 2>/dev/null || true
    pkill -f 'name spochie-b' 2>/dev/null || true
    pkill -f 'sleep 100000' 2>/dev/null || true
    for h in "$LAB/home-a" "$LAB/home-b"; do
      [ -f "$h/daemon.pid" ] && kill "$(cat "$h/daemon.pid")" 2>/dev/null || true
    done
    echo "laboratorio parado"
    ;;
  *) sed -n '2,12p' "$0" ;;
esac
