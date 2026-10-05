#!/usr/bin/env bash
# Author:      0xWulf
# Description: Tests for Stocky's server routes and guard hooks (spec §4.10,
#              §5.4, §7, §8): seeding, movements, undo, races, retire guards,
#              delete stock-scan, part hooks, recalculate, realtime scoping.
#              Run via scripts/test-api.sh (fresh throwaway PocketBase); needs
#              PB_DB (that instance's data.db) to back-date a movement.
# Modified:    2026-10-04
set -euo pipefail

B=${PB_URL:-http://127.0.0.1:8091}
case "$B" in
  http://127.0.0.1:* | http://localhost:*) ;;
  *) echo "refusing to run against $B (loopback only)" >&2; exit 2 ;;
esac
DB=${PB_DB:?set PB_DB to the instance data.db}
TMP=$(mktemp -d)
pass=0
fail=0

req() {
  local m=$1 p=$2 tok=$3 body=${4:-}
  # one body file per call, so parallel requests don't overwrite each other
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
check() {
  local name=$1 want=$2 res=$3 c
  c=$(code "$res")
  if [[ $c =~ ^($want)$ ]]; then
    pass=$((pass + 1)); printf 'PASS  %-66s %s\n' "$name" "$c"
  else
    fail=$((fail + 1)); printf 'FAIL  %-66s %s (want %s) %s\n' "$name" "$c" "$want" "$(json "$res" | head -c 300)"
  fi
}
check_eq() {
  if [ "$2" = "$3" ]; then
    pass=$((pass + 1)); printf 'PASS  %-66s %s\n' "$1" "$3"
  else
    fail=$((fail + 1)); printf 'FAIL  %-66s got %s (want %s)\n' "$1" "$3" "$2"
  fi
}
# check_err NAME CODE RESPONSE: a 400 whose data.code is CODE
check_err() {
  local c d
  c=$(code "$3"); d=$(json "$3" | jq -r '.data.code // empty')
  if [ "$c" = 400 ] && [ "$d" = "$2" ]; then
    pass=$((pass + 1)); printf 'PASS  %-66s 400 %s\n' "$1" "$d"
  else
    fail=$((fail + 1)); printf 'FAIL  %-66s %s %s (want 400 %s) %s\n' "$1" "$c" "$d" "$2" "$(json "$3" | head -c 300)"
  fi
}
field() { json "$1" | jq -r "$2"; }

today=$(date -u +%F)
in3days=$(date -u -d '+3 days' +%F)

# --- setup -------------------------------------------------------------------
SU=$(field "$(req POST /api/collections/_superusers/auth-with-password '' '{"identity":"su@test.local","password":"SuperPass123"}')" .token)
mkuser() { field "$(req POST /api/collections/users/records "$SU" "{\"email\":\"$1\",\"password\":\"UserPass123\",\"passwordConfirm\":\"UserPass123\"}")" .id; }
login() { field "$(req POST /api/collections/users/auth-with-password '' "{\"identity\":\"$1\",\"password\":\"UserPass123\"}")" .token; }
UA=$(mkuser a@test.local); UB=$(mkuser b@test.local)
TA=$(login a@test.local); TB=$(login b@test.local)

echo '# seed presets (spec §5.4, decision #20)'
# A opts into the example preset before the first seed (the rest of this
# suite uses its Lab/Office/pi-a lists); B keeps the default
check_err_any() { [ "$(code "$2")" = 400 ] && { pass=$((pass + 1)); printf 'PASS  %-66s 400\n' "$1"; } || { fail=$((fail + 1)); printf 'FAIL  %-66s %s\n' "$1" "$(code "$2")"; }; }
check_err_any 'unknown preset name rejected by the select field' "$(req PATCH "/api/collections/users/records/$UA" "$SU" '{"seedPreset":"bogus"}')"
check 'superuser sets A seedPreset=example' 200 "$(req PATCH "/api/collections/users/records/$UA" "$SU" '{"seedPreset":"example"}')"
R=$(req POST /api/stocky/seed "$TA")
check 'A seeds' 200 "$R"; check_eq '  seeded=true, preset=example' 'true example' "$(field "$R" '"\(.seeded) \(.preset)"')"
check_eq 'A seeds again: seeded=false' false "$(field "$(req POST /api/stocky/seed "$TA")" .seeded)"
# B seeds twice in parallel: still one set of lists
req POST /api/stocky/seed "$TB" >"$TMP/p1" & req POST /api/stocky/seed "$TB" >"$TMP/p2" & wait
check_eq 'B parallel seeds: exactly one seeded=true' 1 "$(cat "$TMP/p1" "$TMP/p2" | grep -c '"seeded":true' || true)"
check_eq '  ...with preset=standard (empty seedPreset)' 1 "$(cat "$TMP/p1" "$TMP/p2" | grep -c '"preset":"standard"' || true)"
cnt() { field "$(req GET "/api/collections/$1/records?perPage=200" "$2")" .totalItems; }
keys() { field "$(req GET "/api/collections/$1/records?perPage=200&sort=sortOrder" "$2")" '[.items[].key] | join(",")'; }
check_eq 'A (example) has 3 locations' 3 "$(cnt locations "$TA")"
check_eq 'A (example) has 8 hosts' 8 "$(cnt hosts "$TA")"
check_eq 'A (example) has 8 categories' 8 "$(cnt categories "$TA")"
check_eq 'B (standard) locations: home, in_transit (no duplicates)' 'home,in_transit' "$(keys locations "$TB")"
check_eq 'B (standard) has no hosts' 0 "$(cnt hosts "$TB")"
check_eq 'B (standard) categories: the 9 generic ones in order' \
  'computers,components,storage,networking,power,cables,peripherals,consumables,other' "$(keys categories "$TB")"
check_eq 'B (standard) category label for cables' 'Cables & adapters' \
  "$(field "$(req GET "/api/collections/categories/records?filter=key%3D%27cables%27" "$TB")" '.items[0].label')"
check_eq 'A seedVersion = 1' 1 "$(field "$(req GET "/api/collections/users/records/$UA" "$TA")" .seedVersion)"
byKey() { field "$(req GET "/api/collections/$1/records?filter=key%3D%27$2%27" "$3")" '.items[0].id'; }
LAB=$(byKey locations lab "$TA"); OFC=$(byKey locations office "$TA"); TRN=$(byKey locations in_transit "$TA")
PIA=$(byKey hosts pi_a "$TA"); NASB=$(byKey hosts nas_b "$TA"); RTRA=$(byKey hosts router_a "$TA")
STORAGE=$(byKey categories storage "$TA"); OTHER=$(byKey categories other "$TA")
B_HOME=$(byKey locations home "$TB"); B_STORAGE=$(byKey categories storage "$TB")
loc() { field "$(req GET "/api/collections/locations/records/$1" "$TA")" "$2"; }
check_eq 'lab referenced after seed (it has hosts)' true "$(loc "$LAB" .referenced)"
check_eq 'in_transit not referenced after seed' false "$(loc "$TRN" .referenced)"
check_eq 'B home not referenced after seed (no hosts)' false "$(field "$(req GET "/api/collections/locations/records/$B_HOME" "$TB")" .referenced)"
check_eq 'B home has no default currency' '' "$(field "$(req GET "/api/collections/locations/records/$B_HOME" "$TB")" .defaultCurrency)"
# setting the preset after the first seed changes nothing (spec §5.4)
req PATCH "/api/collections/users/records/$UB" "$SU" '{"seedPreset":"example"}' >/dev/null
check_eq 'B seedPreset=example after seeding: seed is a no-op' false "$(field "$(req POST /api/stocky/seed "$TB")" .seeded)"
check_eq '  ...and B still has only home + in_transit' 'home,in_transit' "$(keys locations "$TB")"

echo '# GET /api/stocky/about (About dialog diagnostics, spec §4)'
check 'guest: 401, no versions' 401 "$(req GET /api/stocky/about '')"
check 'superuser token: refused (users only)' '401|403' "$(req GET /api/stocky/about "$SU")"
R=$(req GET /api/stocky/about "$TA")
check 'signed-in user: 200' 200 "$R"
check_eq '  ...PocketBase version from STOCKY_PB_VERSION' "${PB_VERSION_EXPECTED:-0.40.4}" "$(field "$R" .pocketbase)"
check_eq '  ...schema = the newest migration file' "$(ls "$(dirname "$0")/../pb_migrations" | sort | tail -1 | cut -d_ -f1)" "$(field "$R" .schema)"

echo '# presets from <pb_data>/stocky-presets.json (decision #27)'
PRESETS="${PB_DATA:-$(dirname "$DB")}/stocky-presets.json"
cat >"$PRESETS" <<'JSON'
{
  "private_lab": {
    "label": "Private lab",
    "locations": [
      { "key": "shed", "label": "Shed", "kind": "site", "defaultCurrency": "EUR" },
      { "key": "in_transit", "label": "In transit", "kind": "transit" }
    ],
    "hosts": [{ "key": "box1", "label": "box1", "type": "Mini PC", "site": "shed" }],
    "categories": [{ "key": "other", "label": "Other" }]
  }
}
JSON
UC=$(mkuser c@test.local)
check 'a preset from the file can be chosen' 200 "$(req PATCH "/api/collections/users/records/$UC" "$SU" '{"seedPreset":"private_lab"}')"
TC=$(login c@test.local)
R=$(req POST /api/stocky/seed "$TC")
check_eq '  ...and seeds its lists' 'true private_lab' "$(field "$R" '"\(.seeded) \(.preset)"')"
check_eq '  ...locations shed, in_transit; host box1' 'shed,in_transit box1' "$(keys locations "$TC") $(keys hosts "$TC")"
check_err 'an unknown preset is refused (the old select values, now a hook)' unknown_preset "$(req PATCH "/api/collections/users/records/$UC" "$SU" '{"seedPreset":"nope"}')"
check 'built-in example still valid' 200 "$(req PATCH "/api/collections/users/records/$UC" "$SU" '{"seedPreset":"example"}')"
cat >"$PRESETS" <<'JSON'
{ "standard": { "locations": [], "hosts": [], "categories": [] },
  "two_transits": { "locations": [ { "key": "a", "label": "A", "kind": "transit" }, { "key": "b", "label": "B", "kind": "transit" } ], "hosts": [], "categories": [ { "key": "x", "label": "X" } ] } }
JSON
R=$(req PATCH "/api/collections/users/records/$UC" "$SU" '{"seedPreset":"private_lab"}')
check_err 'an invalid file is ignored: its presets are unknown' unknown_preset "$R"
check_eq '  ...and the message says why' 'true true' "$(field "$R" '.message | (contains("can'"'"'t be replaced")) , (contains("exactly one transit"))' | paste -sd' ')"
echo 'not json' >"$PRESETS"
check_err 'a file that is not JSON: unknown_preset, built-ins still work' unknown_preset "$(req PATCH "/api/collections/users/records/$UC" "$SU" '{"seedPreset":"private_lab"}')"
check 'built-in standard still valid' 200 "$(req PATCH "/api/collections/users/records/$UC" "$SU" '{"seedPreset":"standard"}')"
rm -f "$PRESETS"


mv() { req POST /api/stocky/movements "${2-$TA}" "$1"; }
part() { req GET "/api/collections/parts/records/$1" "$TA"; }

echo '# movements: happy path'
R=$(mv "{\"type\":\"stock_in\",\"quantity\":5,\"toLocation\":\"$LAB\",\"priceMinor\":590,\"priceCurrency\":\"TWD\",\"date\":\"$today\",\"newPart\":{\"name\":\"  High-endurance  microSD 128 GB \",\"category\":\"$STORAGE\",\"unit\":\"pcs\",\"lowStockEnabled\":true,\"lowStockThreshold\":2}}")
check 'stock_in 5 with newPart' 200 "$R"
P=$(field "$R" .part.id); M1=$(field "$R" .movement.id)
check_eq '  name trimmed' 'High-endurance  microSD 128 GB' "$(field "$R" .part.name)"
check_eq '  nameKey normalised' 'high-endurance microsd 128 gb' "$(field "$R" .part.nameKey)"
check_eq '  spare[lab] = 5' 5 "$(field "$R" ".part.spare[\"$LAB\"]")"
check_eq '  spareTotal = 5' 5 "$(field "$R" .part.spareTotal)"
check_eq '  storage category now referenced' true "$(field "$(req GET "/api/collections/categories/records/$STORAGE" "$TA")" .referenced)"
check_eq '  lastMovementId = movement' "$M1" "$(field "$(req GET "/api/collections/users/records/$UA" "$TA")" .lastMovementId)"
check_err 'newPart with duplicate name (case/space-insensitive)' duplicate_name "$(mv "{\"type\":\"stock_in\",\"quantity\":1,\"toLocation\":\"$LAB\",\"date\":\"$today\",\"newPart\":{\"name\":\"HIGH-ENDURANCE MICROSD 128 GB\",\"category\":\"$STORAGE\",\"unit\":\"pcs\"}}")"
check_err 'newPart on a move rejected' invalid_part "$(mv "{\"type\":\"move\",\"quantity\":1,\"fromLocation\":\"$LAB\",\"toLocation\":\"$OFC\",\"date\":\"$today\",\"newPart\":{\"name\":\"X part\",\"category\":\"$STORAGE\",\"unit\":\"pcs\"}}")"

check 'install 1 lab → pi-a' 200 "$(mv "{\"type\":\"install\",\"part\":\"$P\",\"quantity\":1,\"fromLocation\":\"$LAB\",\"toHost\":\"$PIA\",\"date\":\"$today\"}")"
check 'move 2 lab → in transit' 200 "$(mv "{\"type\":\"move\",\"part\":\"$P\",\"quantity\":2,\"fromLocation\":\"$LAB\",\"toLocation\":\"$TRN\",\"date\":\"$today\",\"note\":\"LAB→HAM flight\"}")"
check_eq '  in_transit now referenced' true "$(loc "$TRN" .referenced)"
R=$(mv "{\"type\":\"install\",\"part\":\"$P\",\"quantity\":1,\"fromLocation\":\"$TRN\",\"toHost\":\"$NASB\",\"date\":\"$today\"}")
check 'install 1 in transit → nas-b (Office host)' 200 "$R"; M_INSTALL=$(field "$R" .movement.id)
R=$(part "$P")
check_eq '  spare: lab 2, transit 1' '2 1' "$(field "$R" ".spare[\"$LAB\"]") $(field "$R" ".spare[\"$TRN\"]")"
check_eq '  installed: pi-a 1, nas-b 1' '1 1' "$(field "$R" ".installed[\"$PIA\"]") $(field "$R" ".installed[\"$NASB\"]")"
check_eq '  spareTotal = 3 (includes transit)' 3 "$(field "$R" .spareTotal)"

echo '# movements: validation (spec §8)'
check_err 'install lab stock into nas-b (Office)' install_source "$(mv "{\"type\":\"install\",\"part\":\"$P\",\"quantity\":1,\"fromLocation\":\"$LAB\",\"toHost\":\"$NASB\",\"date\":\"$today\"}")"
R=$(mv "{\"type\":\"stock_out\",\"part\":\"$P\",\"quantity\":10,\"fromLocation\":\"$LAB\",\"reason\":\"used\",\"date\":\"$today\"}")
check_err 'stock_out 10 with 2 available' insufficient_stock "$R"
check_eq '  message' 'Only 2 pcs available at Lab' "$(field "$R" .message)"
check_eq '  data.available' 2 "$(field "$R" .data.available)"
check_err 'stock_out without reason' invalid_reason "$(mv "{\"type\":\"stock_out\",\"part\":\"$P\",\"quantity\":1,\"fromLocation\":\"$LAB\",\"date\":\"$today\"}")"
check_err 'reason on a move' invalid_reason "$(mv "{\"type\":\"move\",\"part\":\"$P\",\"quantity\":1,\"fromLocation\":\"$LAB\",\"toLocation\":\"$OFC\",\"reason\":\"used\",\"date\":\"$today\"}")"
check_err 'move lab → lab' same_location "$(mv "{\"type\":\"move\",\"part\":\"$P\",\"quantity\":1,\"fromLocation\":\"$LAB\",\"toLocation\":\"$LAB\",\"date\":\"$today\"}")"
check_err 'price on a move' invalid_price "$(mv "{\"type\":\"move\",\"part\":\"$P\",\"quantity\":1,\"fromLocation\":\"$LAB\",\"toLocation\":\"$OFC\",\"priceMinor\":5,\"priceCurrency\":\"EUR\",\"date\":\"$today\"}")"
check_err 'price currency JPY (not supported)' invalid_price "$(mv "{\"type\":\"stock_in\",\"part\":\"$P\",\"quantity\":1,\"toLocation\":\"$LAB\",\"priceMinor\":5,\"priceCurrency\":\"JPY\",\"date\":\"$today\"}")"
check_err 'price 12.5 (not whole)' invalid_price "$(mv "{\"type\":\"stock_in\",\"part\":\"$P\",\"quantity\":1,\"toLocation\":\"$LAB\",\"priceMinor\":12.5,\"priceCurrency\":\"EUR\",\"date\":\"$today\"}")"
check_err "date 3 days ahead ($in3days)" future_date "$(mv "{\"type\":\"stock_in\",\"part\":\"$P\",\"quantity\":1,\"toLocation\":\"$LAB\",\"date\":\"$in3days\"}")"
check_err 'date 2026-02-30' invalid_date "$(mv "{\"type\":\"stock_in\",\"part\":\"$P\",\"quantity\":1,\"toLocation\":\"$LAB\",\"date\":\"2026-02-30\"}")"
check_err 'quantity 0' invalid_quantity "$(mv "{\"type\":\"stock_in\",\"part\":\"$P\",\"quantity\":0,\"toLocation\":\"$LAB\",\"date\":\"$today\"}")"
check_err 'quantity 1.5' invalid_quantity "$(mv "{\"type\":\"stock_in\",\"part\":\"$P\",\"quantity\":1.5,\"toLocation\":\"$LAB\",\"date\":\"$today\"}")"
check_err 'quantity 10000' invalid_quantity "$(mv "{\"type\":\"stock_in\",\"part\":\"$P\",\"quantity\":10000,\"toLocation\":\"$LAB\",\"date\":\"$today\"}")"
check_err 'stock_in with fromLocation' invalid_shape "$(mv "{\"type\":\"stock_in\",\"part\":\"$P\",\"quantity\":1,\"fromLocation\":\"$LAB\",\"toLocation\":\"$LAB\",\"date\":\"$today\"}")"
check_err 'uninstall to a host' invalid_shape "$(mv "{\"type\":\"uninstall\",\"part\":\"$P\",\"quantity\":1,\"fromHost\":\"$PIA\",\"toHost\":\"$NASB\",\"date\":\"$today\"}")"
check_err 'unknown type' invalid_type "$(mv "{\"type\":\"teleport\",\"part\":\"$P\",\"quantity\":1,\"date\":\"$today\"}")"
check_err 'B uses A part' not_found "$(mv "{\"type\":\"stock_in\",\"part\":\"$P\",\"quantity\":1,\"toLocation\":\"$B_HOME\",\"date\":\"$today\"}" "$TB")"
R=$(mv "{\"type\":\"stock_in\",\"quantity\":1,\"toLocation\":\"$B_HOME\",\"date\":\"$today\",\"newPart\":{\"name\":\"B part\",\"category\":\"$B_STORAGE\",\"unit\":\"pcs\"}}" "$TB")
BP=$(field "$R" .part.id)
check_err 'B moves own part into A location' not_found "$(mv "{\"type\":\"move\",\"part\":\"$BP\",\"quantity\":1,\"fromLocation\":\"$B_HOME\",\"toLocation\":\"$LAB\",\"date\":\"$today\"}" "$TB")"
check 'unauthenticated movement rejected' '401' "$(mv "{\"type\":\"stock_in\",\"part\":\"$P\",\"quantity\":1,\"toLocation\":\"$LAB\",\"date\":\"$today\"}" '')"
check 'superuser token rejected by requireAuth(users)' '401|403' "$(mv "{\"type\":\"stock_in\",\"part\":\"$P\",\"quantity\":1,\"toLocation\":\"$LAB\",\"date\":\"$today\"}" "$SU")"
check_eq 'failed movements changed nothing: spareTotal still 3' 3 "$(field "$(part "$P")" .spareTotal)"

echo '# undo (spec §7.4)'
R=$(req POST "/api/stocky/movements/$M_INSTALL/undo" "$TA" "{\"date\":\"$today\"}")
check 'undo newest (install → nas-b)' 200 "$R"; M_REV=$(field "$R" .movement.id)
check_eq '  reversal type' uninstall "$(field "$R" .movement.type)"
check_eq '  reversal goes nas-b → in transit' "$NASB $TRN" "$(field "$R" .movement.fromHost) $(field "$R" .movement.toLocation)"
check_eq '  reverses = original' "$M_INSTALL" "$(field "$R" .movement.reverses)"
check_eq '  note' "Undo of $today install" "$(field "$R" .movement.note)"
check_eq '  nas-b no longer in installed' null "$(field "$R" ".part.installed[\"$NASB\"]")"
check_eq '  transit back to 2' 2 "$(field "$R" ".part.spare[\"$TRN\"]")"
check_err 'undo the same movement again' already_undone "$(req POST "/api/stocky/movements/$M_INSTALL/undo" "$TA" '{}')"
check_err 'undo the undo' is_reversal "$(req POST "/api/stocky/movements/$M_REV/undo" "$TA" '{}')"
check_err 'undo an older movement' not_newest "$(req POST "/api/stocky/movements/$M1/undo" "$TA" '{}')"
check_err 'B undoes A movement' not_found "$(req POST "/api/stocky/movements/$M_REV/undo" "$TB" '{}')"
R=$(mv "{\"type\":\"move\",\"part\":\"$P\",\"quantity\":1,\"fromLocation\":\"$LAB\",\"toLocation\":\"$OFC\",\"date\":\"$today\"}")
M_OLD=$(field "$R" .movement.id)
sqlite3 "$DB" "UPDATE movements SET created = strftime('%Y-%m-%d %H:%M:%fZ','now','-25 hours') WHERE id = '$M_OLD';"
check_err 'undo after 25 h' window_passed "$(req POST "/api/stocky/movements/$M_OLD/undo" "$TA" '{}')"
sqlite3 "$DB" "UPDATE movements SET created = strftime('%Y-%m-%d %H:%M:%fZ','now','-23 hours') WHERE id = '$M_OLD';"
check 'undo after 23 h' 200 "$(req POST "/api/stocky/movements/$M_OLD/undo" "$TA" "{\"date\":\"$today\"}")"

echo '# two devices race for the same stock'
# lab has 2: two parallel stock_outs of 2 → exactly one wins
body="{\"type\":\"stock_out\",\"part\":\"$P\",\"quantity\":2,\"fromLocation\":\"$LAB\",\"reason\":\"used\",\"date\":\"$today\"}"
mv "$body" >"$TMP/r1" & mv "$body" >"$TMP/r2" & wait
check_eq 'parallel stock_out: one 200' 1 "$(cut -d' ' -f1 "$TMP/r1" "$TMP/r2" | grep -c '^200$' || true)"
check_eq 'parallel stock_out: one insufficient_stock' 1 "$(cat "$TMP/r1" "$TMP/r2" | grep -c 'insufficient_stock' || true)"
check_eq '  lab now empty' null "$(field "$(part "$P")" ".spare[\"$LAB\"]")"

check 'price currency USD accepted (own part, stock elsewhere untouched)' 200 "$(mv "{\"type\":\"stock_in\",\"quantity\":1,\"toLocation\":\"$TRN\",\"priceMinor\":1299,\"priceCurrency\":\"USD\",\"date\":\"$today\",\"newPart\":{\"name\":\"USD priced part\",\"category\":\"$STORAGE\",\"unit\":\"pcs\"}}")"
echo '# retire guards and delete scan (spec §4.10, §6.5)'
check 'restock lab 1 (for the guards)' 200 "$(mv "{\"type\":\"stock_in\",\"part\":\"$P\",\"quantity\":1,\"toLocation\":\"$LAB\",\"date\":\"$today\"}")"
R=$(req PATCH "/api/collections/locations/records/$LAB" "$TA" '{"retired":true}')
check_err 'retire lab with spare stock' in_use "$R"
check_eq '  message' "Can't retire Lab — 1 part still has spare stock there. Move or stock them out first." "$(field "$R" .message)"
check_err 'retire office (active hosts, no stock)' has_hosts "$(req PATCH "/api/collections/locations/records/$OFC" "$TA" '{"retired":true}')"
check_err 'retire pi-a (1 installed)' in_use "$(req PATCH "/api/collections/hosts/records/$PIA" "$TA" '{"retired":true}')"
check 'retire router_a (empty)' 200 "$(req PATCH "/api/collections/hosts/records/$RTRA" "$TA" '{"retired":true}')"
check 'retire a category (always allowed)' 200 "$(req PATCH "/api/collections/categories/records/$OTHER" "$TA" '{"retired":true}')"
R=$(req POST /api/collections/locations/records "$TA" "{\"user\":\"$UA\",\"label\":\"Hamburg\",\"kind\":\"site\"}"); HAM=$(field "$R" .id)
check 'host on new site Hamburg' 200 "$(req POST /api/collections/hosts/records "$TA" "{\"user\":\"$UA\",\"label\":\"nuc\",\"site\":\"$HAM\"}")"
check_eq '  Hamburg now referenced' true "$(loc "$HAM" .referenced)"
R=$(req POST /api/collections/locations/records "$TA" "{\"user\":\"$UA\",\"label\":\"Old place\",\"kind\":\"site\"}"); OLDP=$(field "$R" .id)
check 'retire empty Old place' 200 "$(req PATCH "/api/collections/locations/records/$OLDP" "$TA" '{"retired":true}')"
check_err 'host on retired site' retired "$(req POST /api/collections/hosts/records "$TA" "{\"user\":\"$UA\",\"label\":\"ghost\",\"site\":\"$OLDP\"}")"
check 'delete unreferenced empty site' 204 "$(req DELETE "/api/collections/locations/records/$OLDP" "$TA")"
# corrupt the flag as superuser: the stock scan still blocks the delete
req PATCH "/api/collections/locations/records/$LAB" "$SU" '{"referenced":false}' >/dev/null
R=$(req DELETE "/api/collections/locations/records/$LAB" "$TA")
check_err 'delete lab with referenced=false but stock (scan)' in_use "$R"
req PATCH "/api/collections/hosts/records/$PIA" "$SU" '{"referenced":false}' >/dev/null
check_err 'delete pi-a with referenced=false but installed (scan)' in_use "$(req DELETE "/api/collections/hosts/records/$PIA" "$TA")"

echo '# parts via the records API'
R=$(req POST /api/collections/parts/records "$TA" "{\"user\":\"$UA\",\"name\":\"Cat6  patch cable 1 m\",\"category\":\"$STORAGE\",\"unit\":\"pcs\"}")
check 'create part via API' 200 "$R"; P2=$(field "$R" .id)
check_eq '  nameKey set by hook' 'cat6 patch cable 1 m' "$(field "$R" .nameKey)"
check_eq '  spareTotal 0' 0 "$(field "$R" .spareTotal)"
check_err 'duplicate name via API' duplicate_name "$(req POST /api/collections/parts/records "$TA" "{\"user\":\"$UA\",\"name\":\"CAT6 PATCH CABLE 1 M\",\"category\":\"$STORAGE\",\"unit\":\"pcs\"}")"
check_err 'part in retired category' retired "$(req POST /api/collections/parts/records "$TA" "{\"user\":\"$UA\",\"name\":\"Odd thing\",\"category\":\"$OTHER\",\"unit\":\"pcs\"}")"
check_err 'move part to retired category' retired "$(req PATCH "/api/collections/parts/records/$P2" "$TA" "{\"category\":\"$OTHER\"}")"
check_err 'rename part to a duplicate' duplicate_name "$(req PATCH "/api/collections/parts/records/$P2" "$TA" '{"name":"high-endurance microsd 128 gb"}')"
check 'rename part' 200 "$(req PATCH "/api/collections/parts/records/$P2" "$TA" '{"name":"Cat6 patch cable 2 m"}')"
check_eq '  nameKey follows' 'cat6 patch cable 2 m' "$(field "$(part "$P2")" .nameKey)"
check 'archive part' 200 "$(req PATCH "/api/collections/parts/records/$P2" "$TA" '{"archived":true}')"
check_err 'movement on archived part' part_archived "$(mv "{\"type\":\"stock_in\",\"part\":\"$P2\",\"quantity\":1,\"toLocation\":\"$LAB\",\"date\":\"$today\"}")"

echo '# recalculate (spec §7.6)'
R=$(req POST "/api/stocky/parts/$P/recalculate" "$TA" '{}')
check_eq 'stored totals match the replay' true "$(field "$R" .matches)"
req PATCH "/api/collections/parts/records/$P" "$SU" "{\"spare\":{\"$LAB\":99},\"spareTotal\":99}" >/dev/null
R=$(req POST "/api/stocky/parts/$P/recalculate" "$TA" '{}')
check_eq 'after corruption: matches=false' false "$(field "$R" .matches)"
check_eq '  dry run fixed nothing' 99 "$(field "$(part "$P")" .spareTotal)"
R=$(req POST "/api/stocky/parts/$P/recalculate" "$TA" '{"fix":true}')
check_eq 'fix=true: fixed' true "$(field "$R" .fixed)"
check_eq '  replay dipped below zero midway (the 23 h back-dated move) yet fix allowed' true "$(field "$R" .dippedBelowZero)"
check_eq '  matches again' true "$(field "$(req POST "/api/stocky/parts/$P/recalculate" "$TA" '{}')" .matches)"
check_err 'B recalculates A part' not_found "$(req POST "/api/stocky/parts/$P/recalculate" "$TB" '{}')"

echo '# realtime: A sees its own part change, B sees nothing'
sse() { # sse TOKEN OUTFILE: connect, subscribe to parts, keep listening
  curl -sN --max-time 6 "$B/api/realtime" >"$2" &
  local pid=$! cid=''
  for _ in $(seq 1 20); do
    cid=$(grep -o '"clientId":"[^"]*"' "$2" | head -1 | cut -d'"' -f4 || true)
    [ -n "$cid" ] && break; sleep 0.2
  done
  curl -s -o /dev/null -X POST "$B/api/realtime" -H "Authorization: $1" -H 'Content-Type: application/json' -d "{\"clientId\":\"$cid\",\"subscriptions\":[\"parts\"]}"
  echo $pid
}
PA=$(sse "$TA" "$TMP/sseA"); PB=$(sse "$TB" "$TMP/sseB")
sleep 1
mv "{\"type\":\"stock_in\",\"part\":\"$P\",\"quantity\":1,\"toLocation\":\"$OFC\",\"date\":\"$today\"}" >/dev/null
wait "$PA" "$PB" 2>/dev/null || true
check_eq 'A received a parts update for its part' 1 "$(grep -c "\"id\":\"$P\"" "$TMP/sseA" || true)"
check_eq 'B received nothing about A part' 0 "$(grep -c "\"id\":\"$P\"" "$TMP/sseB" || true)"

echo '# static caching (pb_hooks/static_cache.pb.js)'
# hdr URL NAME: one response header's value (case-insensitive), '' if absent
hdr() { curl -s -o /dev/null -D - "$1" | tr -d '\r' | awk -v h="$(tr 'A-Z' 'a-z' <<<"$2")" -F': ' 'tolower($1)==h {print $2}'; }
status_of() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
type_of() { curl -s -o /dev/null -w '%{content_type}' "$1"; }
ASSET=$(curl -s "$B/" | grep -o '/assets/[^"]*\.js' | head -1)
check_eq 'index.html references a hashed asset' 1 "$([ -n "$ASSET" ] && echo 1 || echo 0)"
check_eq '/ (index.html): 200' 200 "$(status_of "$B/")"
check_eq '/ (index.html): Cache-Control no-cache' 'no-cache' "$(hdr "$B/" Cache-Control)"
check_eq '/parts/abc (SPA fallback): 200 html' '200 text/html' "$(status_of "$B/parts/abc") $(type_of "$B/parts/abc" | cut -d';' -f1)"
check_eq '/parts/abc (SPA fallback): Cache-Control no-cache' 'no-cache' "$(hdr "$B/parts/abc" Cache-Control)"
check_eq "$ASSET: 200" 200 "$(status_of "$B$ASSET")"
check_eq "$ASSET: cached a year, immutable" 'public, max-age=31536000, immutable' "$(hdr "$B$ASSET" Cache-Control)"
check_eq 'missing /assets/ file: 404, not index.html' '404' "$(status_of "$B/assets/index-gone0000.js")"
check_eq '  ...and the body is not the app' 0 "$(curl -s "$B/assets/index-gone0000.js" | grep -c '<div id="app">' || true)"
# traversal: a literal ".." is cleaned by the router and redirected before any
# middleware; an encoded one reaches the hook, which refuses it
check_eq '/assets/../index.html: router redirects to the cleaned path' '307 /index.html' \
  "$(status_of --path-as-is "$B/assets/../index.html") $(curl -s -o /dev/null -D - --path-as-is "$B/assets/../index.html" | tr -d '\r' | awk -F': ' 'tolower($1)=="location" {print $2}')"
check_eq '/assets/..%2findex.html (encoded traversal): 404' 404 "$(status_of --path-as-is "$B/assets/..%2findex.html")"
check_eq '/api/health untouched (no app caching header)' '' "$(hdr "$B/api/health" Cache-Control | grep -E 'immutable|no-cache' || true)"

echo
echo "passed: $pass  failed: $fail"
rm -rf "$TMP"
[ "$fail" -eq 0 ]
