#!/usr/bin/env bash
# Author:      0xWulf
# Description: API-rule tests for Stocky (spec §6): sign-up, per-user isolation,
#              guest access, field protection, unique indexes, relation ownership
#              and user cascade delete. Run via scripts/test-api.sh, which starts
#              a throwaway PocketBase; it creates users and deletes them.
# Modified:    2026-10-04
set -euo pipefail

B=${PB_URL:-http://127.0.0.1:8091}
# these tests create and delete users: never point them at a real instance
case "$B" in
  http://127.0.0.1:* | http://localhost:*) ;;
  *) echo "refusing to run against $B (loopback only)" >&2; exit 2 ;;
esac
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
pass=0
fail=0

# req METHOD PATH TOKEN [JSON] -> prints "<status> <body>"
req() {
  local m=$1 p=$2 tok=$3 body=${4:-}
  local out
  out=$(mktemp "$TMP/body.XXXXXX")
  local args=(-s -o "$out" -w '%{http_code}' -X "$m" "$B$p")
  [ -n "$tok" ] && args+=(-H "Authorization: $tok")
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' -d "$body")
  local code
  code=$(curl "${args[@]}")
  echo "$code $(cat "$out")"
  rm -f "$out"
}
code() { cut -d' ' -f1 <<<"$1"; }
json() { cut -d' ' -f2- <<<"$1"; }

# check NAME EXPECTED_REGEX RESPONSE
check() {
  local name=$1 want=$2 res=$3 c
  c=$(code "$res")
  if [[ $c =~ ^($want)$ ]]; then
    pass=$((pass + 1)); printf 'PASS  %-62s %s\n' "$name" "$c"
  else
    fail=$((fail + 1)); printf 'FAIL  %-62s %s (want %s) %s\n' "$name" "$c" "$want" "$(json "$res" | head -c 300)"
  fi
}
# check_eq NAME EXPECTED ACTUAL
check_eq() {
  if [ "$2" = "$3" ]; then
    pass=$((pass + 1)); printf 'PASS  %-62s %s\n' "$1" "$3"
  else
    fail=$((fail + 1)); printf 'FAIL  %-62s got %s (want %s)\n' "$1" "$3" "$2"
  fi
}
id() { json "$1" | jq -r .id; }
total() { json "$1" | jq -r .totalItems; }

# --- setup -------------------------------------------------------------------
SU=$(json "$(req POST /api/collections/_superusers/auth-with-password '' '{"identity":"su@test.local","password":"SuperPass123"}')" | jq -r .token)
mkuser() { id "$(req POST /api/collections/users/records "$SU" "{\"email\":\"$1\",\"password\":\"UserPass123\",\"passwordConfirm\":\"UserPass123\"}")"; }
login() { json "$(req POST /api/collections/users/auth-with-password '' "{\"identity\":\"$1\",\"password\":\"UserPass123\"}")" | jq -r .token; }
UA=$(mkuser a@test.local); UB=$(mkuser b@test.local)
TA=$(login a@test.local); TB=$(login b@test.local)
mk() { id "$(req POST "/api/collections/$1/records" "$SU" "$2")"; }

A_LAB=$(mk locations "{\"user\":\"$UA\",\"key\":\"lab\",\"label\":\"Lab\",\"kind\":\"site\",\"referenced\":true}")
A_OFC=$(mk locations "{\"user\":\"$UA\",\"key\":\"office\",\"label\":\"Office\",\"kind\":\"site\"}")
A_TRN=$(mk locations "{\"user\":\"$UA\",\"key\":\"in_transit\",\"label\":\"In transit\",\"kind\":\"transit\"}")
A_CAT=$(mk categories "{\"user\":\"$UA\",\"key\":\"storage\",\"label\":\"Storage\"}")
A_PIB=$(mk hosts "{\"user\":\"$UA\",\"key\":\"pi_b\",\"label\":\"pi-b\",\"site\":\"$A_LAB\",\"referenced\":true}")
B_LAB=$(mk locations "{\"user\":\"$UB\",\"key\":\"lab\",\"label\":\"Lab\",\"kind\":\"site\"}")
B_CAT=$(mk categories "{\"user\":\"$UB\",\"key\":\"storage\",\"label\":\"Storage\"}")
A_PART=$(mk parts "{\"user\":\"$UA\",\"name\":\"microSD 128 GB\",\"nameKey\":\"microsd 128 gb\",\"category\":\"$A_CAT\",\"unit\":\"pcs\",\"spare\":{\"$A_LAB\":3,\"$A_TRN\":1},\"installed\":{\"$A_PIB\":1},\"spareTotal\":4}")
M1=$(mk movements "{\"user\":\"$UA\",\"part\":\"$A_PART\",\"type\":\"stock_in\",\"quantity\":5,\"toLocation\":\"$A_LAB\",\"priceMinor\":590,\"priceCurrency\":\"TWD\",\"date\":\"2026-09-12\"}")
M2=$(mk movements "{\"user\":\"$UA\",\"part\":\"$A_PART\",\"type\":\"install\",\"quantity\":1,\"fromLocation\":\"$A_LAB\",\"toHost\":\"$A_PIB\",\"date\":\"2026-09-14\"}")
M3=$(mk movements "{\"user\":\"$UA\",\"part\":\"$A_PART\",\"type\":\"uninstall\",\"quantity\":1,\"fromHost\":\"$A_PIB\",\"toLocation\":\"$A_LAB\",\"date\":\"2026-10-04\",\"reverses\":\"$M2\"}")
req PATCH "/api/collections/users/records/$UA" "$SU" "{\"lastMovementId\":\"$M3\",\"seedVersion\":1}" >/dev/null
for v in UA UB A_LAB A_OFC A_TRN A_CAT A_PIB B_LAB B_CAT A_PART M1 M2 M3; do
  [ -n "${!v}" ] && [ "${!v}" != null ] || { echo "setup failed: $v"; exit 1; }
done
echo "setup ok"
echo

echo '# sign-up and users'
check 'unauthenticated sign-up rejected' '4..' "$(req POST /api/collections/users/records '' '{"email":"x@test.local","password":"UserPass123","passwordConfirm":"UserPass123"}')"
check 'authenticated user creating another user rejected' '4..' "$(req POST /api/collections/users/records "$TA" '{"email":"y@test.local","password":"UserPass123","passwordConfirm":"UserPass123"}')"
check 'A views own user record' '200' "$(req GET "/api/collections/users/records/$UA" "$TA")"
check 'A views B user record' '404' "$(req GET "/api/collections/users/records/$UB" "$TA")"
check 'A updates own user record (seedVersion) rejected' '4..' "$(req PATCH "/api/collections/users/records/$UA" "$TA" '{"seedVersion":0}')"
check 'A sets own seedPreset rejected (superuser only, spec §5.4)' '4..' "$(req PATCH "/api/collections/users/records/$UA" "$TA" '{"seedPreset":"example"}')"
check 'A deletes own user record rejected' '4..' "$(req DELETE "/api/collections/users/records/$UA" "$TA")"

echo '# unauthenticated access returns nothing'
for c in users locations hosts categories parts movements; do
  check_eq "guest list $c: totalItems" 0 "$(total "$(req GET "/api/collections/$c/records" '')")"
done
check 'guest view A part' '404' "$(req GET "/api/collections/parts/records/$A_PART" '')"
check 'guest view A location' '404' "$(req GET "/api/collections/locations/records/$A_LAB" '')"
check 'guest view A movement' '404' "$(req GET "/api/collections/movements/records/$M1" '')"

echo '# isolation between users'
check_eq 'B list locations: only own (1)' 1 "$(total "$(req GET /api/collections/locations/records "$TB")")"
check_eq 'B list parts: 0' 0 "$(total "$(req GET /api/collections/parts/records "$TB")")"
check_eq 'B list movements: 0' 0 "$(total "$(req GET /api/collections/movements/records "$TB")")"
check_eq 'B filter parts by user=A: 0' 0 "$(total "$(req GET "/api/collections/parts/records?filter=user%3D%27$UA%27" "$TB")")"
check 'B view A part' '404' "$(req GET "/api/collections/parts/records/$A_PART" "$TB")"
check_eq 'A list movements: 3' 3 "$(total "$(req GET /api/collections/movements/records "$TA")")"

echo '# json stock maps round-trip (encoding/json v2)'
check_eq 'A reads spare[lab]' 3 "$(json "$(req GET "/api/collections/parts/records/$A_PART" "$TA")" | jq -r ".spare[\"$A_LAB\"]")"
check_eq 'A reads installed[pi-b]' 1 "$(json "$(req GET "/api/collections/parts/records/$A_PART" "$TA")" | jq -r ".installed[\"$A_PIB\"]")"

echo '# locations'
check 'A creates own site' '200' "$(req POST /api/collections/locations/records "$TA" "{\"user\":\"$UA\",\"label\":\"Hamburg\",\"kind\":\"site\"}")"
check 'A creates location for B rejected' '400' "$(req POST /api/collections/locations/records "$TA" "{\"user\":\"$UB\",\"label\":\"Sneaky\",\"kind\":\"site\"}")"
check 'A creates transit location rejected' '400' "$(req POST /api/collections/locations/records "$TA" "{\"user\":\"$UA\",\"label\":\"Transit 2\",\"kind\":\"transit\"}")"
check 'A creates location with referenced rejected' '400' "$(req POST /api/collections/locations/records "$TA" "{\"user\":\"$UA\",\"label\":\"Ref\",\"kind\":\"site\",\"referenced\":false}")"
check 'A creates location with key rejected' '400' "$(req POST /api/collections/locations/records "$TA" "{\"user\":\"$UA\",\"label\":\"Keyed\",\"kind\":\"site\",\"key\":\"keyed\"}")"
check 'A renames own site' '200' "$(req PATCH "/api/collections/locations/records/$A_OFC" "$TA" '{"label":"Office (annex)"}')"
check 'A sets referenced=false on own site rejected' '404' "$(req PATCH "/api/collections/locations/records/$A_LAB" "$TA" '{"referenced":false}')"
check 'A changes kind rejected' '404' "$(req PATCH "/api/collections/locations/records/$A_OFC" "$TA" '{"kind":"transit"}')"
check 'A moves own site to B rejected' '404' "$(req PATCH "/api/collections/locations/records/$A_OFC" "$TA" "{\"user\":\"$UB\"}")"
check 'A renames B site rejected' '404' "$(req PATCH "/api/collections/locations/records/$B_LAB" "$TA" '{"label":"Mine"}')"
check 'A retires In transit rejected' '404' "$(req PATCH "/api/collections/locations/records/$A_TRN" "$TA" '{"retired":true}')"
check 'A renames In transit' '200' "$(req PATCH "/api/collections/locations/records/$A_TRN" "$TA" '{"label":"Suitcase"}')"
check 'A deletes In transit rejected' '404' "$(req DELETE "/api/collections/locations/records/$A_TRN" "$TA")"
check 'A deletes referenced site rejected' '404' "$(req DELETE "/api/collections/locations/records/$A_LAB" "$TA")"

echo '# unique indexes'
check 'second lab key for A rejected' '400' "$(req POST /api/collections/locations/records "$SU" "{\"user\":\"$UA\",\"key\":\"lab\",\"label\":\"Lab 2\",\"kind\":\"site\"}")"
check 'second transit for A rejected' '400' "$(req POST /api/collections/locations/records "$SU" "{\"user\":\"$UA\",\"label\":\"Transit 2\",\"kind\":\"transit\"}")"
check 'label LAB (case-insensitive dup) for A rejected' '400' "$(req POST /api/collections/locations/records "$TA" "{\"user\":\"$UA\",\"label\":\"LAB\",\"kind\":\"site\"}")"
check 'B label "lab" dup of own "Lab" rejected (A+B both have Lab)' '400' "$(req POST /api/collections/locations/records "$TB" "{\"user\":\"$UB\",\"label\":\"lab\",\"kind\":\"site\"}")"
R=$(req POST /api/collections/locations/records "$TA" "{\"user\":\"$UA\",\"label\":\"Old Site\",\"kind\":\"site\"}"); OLD=$(id "$R")
check 'A retires unreferenced site' '200' "$(req PATCH "/api/collections/locations/records/$OLD" "$TA" '{"retired":true}')"
check 'A reuses label of a retired site' '200' "$(req POST /api/collections/locations/records "$TA" "{\"user\":\"$UA\",\"label\":\"old site\",\"kind\":\"site\"}")"
check 'A unretires site whose label is taken rejected' '400' "$(req PATCH "/api/collections/locations/records/$OLD" "$TA" '{"retired":false}')"
check 'A deletes unreferenced retired site' '204' "$(req DELETE "/api/collections/locations/records/$OLD" "$TA")"
check 'empty keys do not collide (2 categories, no key)' '200' "$(req POST /api/collections/categories/records "$TA" "{\"user\":\"$UA\",\"label\":\"Misc 1\"}")"
check 'empty keys do not collide (2nd)' '200' "$(req POST /api/collections/categories/records "$TA" "{\"user\":\"$UA\",\"label\":\"Misc 2\"}")"

echo '# hosts: relation ownership in rules'
check 'A creates host on own site' '200' "$(req POST /api/collections/hosts/records "$TA" "{\"user\":\"$UA\",\"label\":\"minipc\",\"site\":\"$A_OFC\"}")"
check 'A creates host on B site rejected' '400' "$(req POST /api/collections/hosts/records "$TA" "{\"user\":\"$UA\",\"label\":\"evil\",\"site\":\"$B_LAB\"}")"
check 'A creates host on In transit rejected' '400' "$(req POST /api/collections/hosts/records "$TA" "{\"user\":\"$UA\",\"label\":\"bag\",\"site\":\"$A_TRN\"}")"
check 'A moves host to B site rejected' '404' "$(req PATCH "/api/collections/hosts/records/$A_PIB" "$TA" "{\"site\":\"$B_LAB\"}")"
check 'A moves host to own other site' '200' "$(req PATCH "/api/collections/hosts/records/$A_PIB" "$TA" "{\"site\":\"$A_OFC\"}")"
check 'A deletes referenced host rejected' '404' "$(req DELETE "/api/collections/hosts/records/$A_PIB" "$TA")"

echo '# parts'
R=$(req POST /api/collections/parts/records "$TA" "{\"user\":\"$UA\",\"name\":\"Pi 5\",\"category\":\"$A_CAT\",\"unit\":\"pcs\"}")
check 'A creates part (hook sets nameKey)' '200' "$R"
check_eq '  ...nameKey from the hook, stock empty' 'pi 5 0' "$(json "$R" | jq -r '"\(.nameKey) \(.spareTotal)"')"
R=$(req POST /api/collections/parts/records "$TA" "{\"user\":\"$UA\",\"name\":\"Pi 5\",\"category\":\"$B_CAT\",\"unit\":\"pcs\"}")
check 'A creates part in B category rejected by rule' '400' "$R"
check_eq '  ...rule failure has no field errors' '' "$(json "$R" | jq -r '.data | keys | join(",")')"
check 'A creates part with spare rejected by rule' '400' "$(req POST /api/collections/parts/records "$TA" "{\"user\":\"$UA\",\"name\":\"Pi 5\",\"category\":\"$A_CAT\",\"unit\":\"pcs\",\"spare\":{}}")"
check 'A updates part name' '200' "$(req PATCH "/api/collections/parts/records/$A_PART" "$TA" '{"name":"High-endurance microSD 128 GB"}')"
check 'A updates part user to B rejected' '404' "$(req PATCH "/api/collections/parts/records/$A_PART" "$TA" "{\"user\":\"$UB\"}")"
check 'A updates part category to B category rejected' '404' "$(req PATCH "/api/collections/parts/records/$A_PART" "$TA" "{\"category\":\"$B_CAT\"}")"
check 'A updates part spare rejected' '404' "$(req PATCH "/api/collections/parts/records/$A_PART" "$TA" "{\"spare\":{\"$A_LAB\":99}}")"
check 'A updates part spareTotal rejected' '404' "$(req PATCH "/api/collections/parts/records/$A_PART" "$TA" '{"spareTotal":99}')"
check 'A updates part nameKey rejected' '404' "$(req PATCH "/api/collections/parts/records/$A_PART" "$TA" '{"nameKey":"x"}')"
check 'A sets lowStockEnabled + threshold 0' '200' "$(req PATCH "/api/collections/parts/records/$A_PART" "$TA" '{"lowStockEnabled":true,"lowStockThreshold":0}')"
check 'B updates A part rejected' '404' "$(req PATCH "/api/collections/parts/records/$A_PART" "$TB" '{"name":"mine"}')"
check 'A deletes part rejected' '403' "$(req DELETE "/api/collections/parts/records/$A_PART" "$TA")"

echo '# movements: append-only, server only'
check 'A creates movement rejected' '403' "$(req POST /api/collections/movements/records "$TA" "{\"user\":\"$UA\",\"part\":\"$A_PART\",\"type\":\"stock_in\",\"quantity\":1,\"toLocation\":\"$A_LAB\",\"date\":\"2026-10-04\"}")"
check 'A updates movement rejected' '403' "$(req PATCH "/api/collections/movements/records/$M1" "$TA" '{"quantity":9}')"
check 'A deletes movement rejected' '403' "$(req DELETE "/api/collections/movements/records/$M1" "$TA")"
check 'bad date pattern rejected (even as superuser)' '400' "$(req POST /api/collections/movements/records "$SU" "{\"user\":\"$UA\",\"part\":\"$A_PART\",\"type\":\"stock_in\",\"quantity\":1,\"toLocation\":\"$A_LAB\",\"date\":\"4/10/2026\"}")"
check 'quantity 0 rejected (even as superuser)' '400' "$(req POST /api/collections/movements/records "$SU" "{\"user\":\"$UA\",\"part\":\"$A_PART\",\"type\":\"stock_in\",\"quantity\":0,\"toLocation\":\"$A_LAB\",\"date\":\"2026-10-04\"}")"
check 'priceMinor 0 accepted (empty currency = no price)' '200' "$(req POST /api/collections/movements/records "$SU" "{\"user\":\"$UA\",\"part\":\"$A_PART\",\"type\":\"stock_in\",\"quantity\":1,\"toLocation\":\"$A_LAB\",\"priceMinor\":0,\"date\":\"2026-10-04\"}")"

echo '# cascade: superuser deletes user A (parts, movements, self-relation)'
check 'superuser deletes user A' '204' "$(req DELETE "/api/collections/users/records/$UA" "$SU")"
for c in locations hosts categories parts movements; do
  check_eq "  A's $c left" 0 "$(total "$(req GET "/api/collections/$c/records?filter=user%3D%27$UA%27" "$SU")")"
done
check_eq "  B's locations untouched" 1 "$(total "$(req GET "/api/collections/locations/records?filter=user%3D%27$UB%27" "$SU")")"

echo
echo "passed: $pass  failed: $fail"
[ "$fail" -eq 0 ]
