#!/bin/sh
set -euo pipefail

CIRCUIT=circuits/claim_from_state_root.circom
OUT=circuits/out
mkdir -p "$OUT"

# Compile (include paths may need adjustment in your env)
circom "$CIRCUIT" \
  --r1cs --wasm --sym \
  -l node_modules \
  -o "$OUT"

# Setup
./scripts/prepare_ptau.sh
npx snarkjs groth16 setup "$OUT/claim_from_state_root.r1cs" powersOfTau28_hez_final_19.ptau "$OUT/claim_0000.zkey"
echo "random entropy" | npx snarkjs zkey contribute "$OUT/claim_0000.zkey" "$OUT/claim_final.zkey" --name="poc"
npx snarkjs zkey export verificationkey "$OUT/claim_final.zkey" "$OUT/verification_key.json"
npx snarkjs zkey export solidityverifier "$OUT/claim_final.zkey" contracts/Verifier.sol

echo "[ok] circuit built and Verifier.sol exported to contracts/Verifier.sol"
