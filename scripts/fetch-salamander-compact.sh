#!/bin/sh
set -eu

# Reproducible compact subset of Salamander Grand Piano V3.
# The source revision is pinned so factory instruments do not drift over time.
readonly SOURCE_REVISION="3382bf9496bba2486f5ab0de55a264d1dfc38404"
readonly SOURCE_BASE="https://raw.githubusercontent.com/sfzinstruments/SalamanderGrandPiano/${SOURCE_REVISION}/Samples"
readonly SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
readonly DESTINATION="${SCRIPT_DIR}/../frontend/public/samples/salamander-compact"

mkdir -p "$DESTINATION"

for root in A0 C1 C2 C3 C4 C5 C6 C7 C8; do
  for layer in 2 6 10 14; do
    filename="${root}v${layer}.flac"
    destination="${DESTINATION}/${filename}"
    if [ -s "$destination" ]; then
      printf 'Already present: %s\n' "$filename"
      continue
    fi
    printf 'Downloading: %s\n' "$filename"
    curl --fail --location --retry 3 --output "$destination" "${SOURCE_BASE}/${filename}"
  done
done

(
  cd "$DESTINATION"
  shasum -a 256 -c SHA256SUMS
)
