#!/bin/sh
set -euo pipefail

RPC="$1"           # e.g. https://mainnet.infura.io/v3/xxx
TOKEN="$2"         # deployed ZWToken address
SECRET="$3"        # 0x...
MAGIC="$4"         # 0x...
TO="$5"            # recipient EOA
PK="$6"            # sender private key (to pay gas)

# 1) build inputs
node client/build_inputs.js --rpc "$RPC" --token "$TOKEN" --secret "$SECRET" --magic "$MAGIC" --to "$TO" > inputs.json

# 2) assume proof.json already generated via circom/snarkjs into proof.json
# submit
node client/submit_claim.js --rpc "$RPC" --pk "$PK" --contract "$TOKEN" --proof proof.json --inputs inputs.json
