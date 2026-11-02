#!/usr/bin/env bash
# Genera supabase/functions/notifiche/index.ts (autosufficiente) a partire da
# sorgente.ts, includendo app/js/notifiche-logica.js e app/js/frasi.js.
# Da rilanciare dopo ogni modifica a quei file, poi ripubblicare la funzione.
set -euo pipefail
cd "$(dirname "$0")/.."
npx -y esbuild@0.24.0 supabase/functions/notifiche/sorgente.ts \
  --bundle --format=esm --platform=neutral --target=esnext \
  --external:npm:* --legal-comments=none \
  --banner:js="// @ts-nocheck
// FILE GENERATO da sorgente.ts con scripts/costruisci-funzione.sh: non modificare a mano.
// Supabase Edge Function \"notifiche\": manda le notifiche push dell'app Impegni.
// Secrets richiesti: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
// deno-lint-ignore-file" \
  --outfile=supabase/functions/notifiche/index.ts
echo "index.ts generato: $(wc -l < supabase/functions/notifiche/index.ts) righe"
