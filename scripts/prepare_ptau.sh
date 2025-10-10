#!/bin/sh
set -euo pipefail

PTAU_URL="https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_19.ptau"
PTAU_FILE="powersOfTau28_hez_final_19.ptau"

if [ -f "$PTAU_FILE" ]; then
  echo "[ok] $PTAU_FILE exists"
  exit 0
fi

curl -L "$PTAU_URL" -o "$PTAU_FILE"
sha256sum "$PTAU_FILE" || shasum -a 256 "$PTAU_FILE" || true
