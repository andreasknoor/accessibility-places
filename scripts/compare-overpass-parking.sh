#!/usr/bin/env bash
# Compares disabled-parking OSM data between the private and public Overpass endpoints.
# Uses the same query as fetchOsmDisabledParking() in lib/adapters/osm.ts.
#
# Usage:
#   bash scripts/compare-overpass-parking.sh
#   RADIUS=10 bash scripts/compare-overpass-parking.sh   # custom radius in km
#   PUBLIC=https://overpass.kumi.systems/api/interpreter bash scripts/compare-overpass-parking.sh
#
# Requires: curl, jq

set -euo pipefail

PRIVATE="${PRIVATE:-https://overpass.accessible-places.org/api/interpreter}"
PUBLIC="${PUBLIC:-https://overpass.kumi.systems/api/interpreter}"

# Berlin Mitte
LAT=52.5200
LON=13.4050
RADIUS_KM="${RADIUS:-5}"
RADIUS_M=$(python3 -c "print(int($RADIUS_KM * 1000))")

# Identical to fetchOsmDisabledParking() in lib/adapters/osm.ts
QUERY="[out:json][timeout:30];(\
way(around:${RADIUS_M},${LAT},${LON})[amenity=parking][\"capacity:disabled\"];\
way(around:${RADIUS_M},${LAT},${LON})[amenity=parking][\"capacity:wheelchair\"];\
node(around:${RADIUS_M},${LAT},${LON})[amenity=parking_space][parking_space=disabled];\
node(around:${RADIUS_M},${LAT},${LON})[amenity=parking_space][wheelchair=designated];\
);out 500 center tags;"

ms() { python3 -c "import time; print(int(time.time()*1000))"; }

echo "Overpass Parking Data Comparison"
echo "Location : Berlin Mitte (${LAT}, ${LON}), radius ${RADIUS_KM} km"
echo "Query    : same as fetchOsmDisabledParking() in lib/adapters/osm.ts"
echo ""

echo "▶ Private ($PRIVATE)..."
T0=$(ms)
PRIVATE_JSON=$(curl -s --max-time 60 -X POST "$PRIVATE" --data-urlencode "data=$QUERY")
PRIVATE_MS=$(( $(ms) - T0 ))
HTTP_CHECK=$(echo "$PRIVATE_JSON" | jq -e '.elements' > /dev/null 2>&1 && echo ok || echo "INVALID JSON — server may have returned an error")
[[ "$HTTP_CHECK" != "ok" ]] && { echo "  ERROR: $PRIVATE returned non-JSON"; echo "$PRIVATE_JSON" | head -5; exit 1; }

echo "▶ Public  ($PUBLIC)..."
T0=$(ms)
PUBLIC_JSON=$(curl -s --max-time 60 -X POST "$PUBLIC" --data-urlencode "data=$QUERY")
PUBLIC_MS=$(( $(ms) - T0 ))
HTTP_CHECK=$(echo "$PUBLIC_JSON" | jq -e '.elements' > /dev/null 2>&1 && echo ok || echo err)
[[ "$HTTP_CHECK" != "ok" ]] && { echo "  ERROR: $PUBLIC returned non-JSON"; echo "$PUBLIC_JSON" | head -5; exit 1; }

P_COUNT=$(echo "$PRIVATE_JSON" | jq '.elements | length')
U_COUNT=$(echo "$PUBLIC_JSON"  | jq '.elements | length')

echo ""
echo "══════════════════════════════════════════════"
printf "  %-10s  %4s elements  %sms\n" "Private:" "$P_COUNT" "$PRIVATE_MS"
printf "  %-10s  %4s elements  %sms\n" "Public:"  "$U_COUNT" "$PUBLIC_MS"
echo "══════════════════════════════════════════════"

# Sorted ID lists (type/id)
P_IDS=$(echo "$PRIVATE_JSON" | jq -r '.elements[] | "\(.type)/\(.id)"' | sort)
U_IDS=$(echo "$PUBLIC_JSON"  | jq -r '.elements[] | "\(.type)/\(.id)"' | sort)

ONLY_P=$(comm -23 <(echo "$P_IDS") <(echo "$U_IDS") | grep . || true)
ONLY_U=$(comm -13 <(echo "$P_IDS") <(echo "$U_IDS") | grep . || true)
ONLY_P_COUNT=$(echo "$ONLY_P" | grep -c . || true)
ONLY_U_COUNT=$(echo "$ONLY_U" | grep -c . || true)
BOTH_COUNT=$(comm -12 <(echo "$P_IDS") <(echo "$U_IDS") | wc -l | tr -d ' ')

echo ""
printf "  %-30s %4s\n" "Matching elements (same ID):" "$BOTH_COUNT"
printf "  %-30s %4s\n" "Only in private:"             "$ONLY_P_COUNT"
printf "  %-30s %4s\n" "Only in public:"              "$ONLY_U_COUNT"

# Capacity value diff for shared elements
CAPACITY_DIFFS=0
CAPACITY_DIFF_LINES=""
while IFS= read -r osm_id; do
  [[ -z "$osm_id" ]] && continue
  type="${osm_id%/*}"
  eid="${osm_id#*/}"
  P_CAP=$(echo "$PRIVATE_JSON" | jq -r \
    --arg t "$type" --arg id "$eid" \
    '.elements[] | select(.type==$t and (.id|tostring)==$id)
     | .tags["capacity:disabled"] // .tags["capacity:wheelchair"] // "–"')
  U_CAP=$(echo "$PUBLIC_JSON"  | jq -r \
    --arg t "$type" --arg id "$eid" \
    '.elements[] | select(.type==$t and (.id|tostring)==$id)
     | .tags["capacity:disabled"] // .tags["capacity:wheelchair"] // "–"')
  if [[ "$P_CAP" != "$U_CAP" ]]; then
    CAPACITY_DIFF_LINES+="    $osm_id  private=$P_CAP  public=$U_CAP\n"
    (( CAPACITY_DIFFS++ )) || true
  fi
done < <(comm -12 <(echo "$P_IDS") <(echo "$U_IDS"))

printf "  %-30s %4s\n" "Capacity value differences:" "$CAPACITY_DIFFS"

# Details
if [[ -n "$ONLY_P" ]]; then
  echo ""
  echo "── Only in private (newer data or replication ahead) ──"
  echo "$ONLY_P" | sed 's/^/    /'
fi
if [[ -n "$ONLY_U" ]]; then
  echo ""
  echo "── Only in public (replication lag on private?) ──"
  echo "$ONLY_U" | sed 's/^/    /'
fi
if [[ "$CAPACITY_DIFFS" -gt 0 ]]; then
  echo ""
  echo "── Capacity differences (same element, different tag value) ──"
  printf "%b" "$CAPACITY_DIFF_LINES"
fi

echo ""
if [[ "$ONLY_P_COUNT" -eq 0 && "$ONLY_U_COUNT" -eq 0 && "$CAPACITY_DIFFS" -eq 0 ]]; then
  echo "✅  Servers are in sync — identical results."
else
  echo "⚠   Differences detected. Likely replication lag on the private server."
  echo "    To sync: docker exec overpass /app/bin/fetch_osc_and_apply.sh \\"
  echo "               https://download.geofabrik.de/europe/dach-updates/"
fi
