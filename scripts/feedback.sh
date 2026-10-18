#!/usr/bin/env bash
# Läser testarnas feedback (för Claude). Kräver den hemliga läsnyckeln i
# .feedback-token i projektroten (git-ignorerad; satt i Supabase via
# supabase/feedback.local.sql). Ger bara åtkomst till feedbacken.
#
#   scripts/feedback.sh                     # all feedback, nyast först
#   scripts/feedback.sh since 2026-10-20    # från och med ett datum
#   scripts/feedback.sh status 12 done "Fixat i a1b2c3d"   # new | seen | done | wontfix
set -euo pipefail
cd "$(dirname "$0")/.."

URL="https://mqzmtndjfgeujaqzqpeb.supabase.co"
KEY="$(sed -n "s/^  supabasePublishableKey: '\(.*\)',$/\1/p" config.js)"
TOKEN="$(cat .feedback-token)"

rpc() {
  curl -sS -X POST "$URL/rest/v1/rpc/$1" \
    -H "apikey: $KEY" -H "Content-Type: application/json" -d "$2"
}

json() { python3 -c 'import json,sys; v=sys.argv[1]; print(json.dumps(v) if v else "null")' "$1"; }

case "${1:-list}" in
  list)   rpc feedback_list "{\"p_token\": $(json "$TOKEN")}" ;;
  since)  rpc feedback_list "{\"p_token\": $(json "$TOKEN"), \"p_since\": $(json "$2")}" ;;
  status) rpc feedback_set_status "{\"p_token\": $(json "$TOKEN"), \"p_id\": $2, \"p_status\": $(json "$3"), \"p_note\": $(json "${4:-}")}" ;;
  *) echo "Okänt kommando: $1" >&2; exit 1 ;;
esac
echo
