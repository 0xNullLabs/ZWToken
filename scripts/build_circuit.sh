#!/bin/bash

# Build Circuit Script for ZWToken
# Compiles claim_first_receipt.circom and generates verifier contract

set -e  # Exit on error

echo "🔧 ZWToken Circuit Build Script"
echo "=================================="
echo ""

# Configuration
CIRCUIT_NAME="remint"
CIRCUIT_FILE="circuits/${CIRCUIT_NAME}.circom"
OUT_DIR="circuits/out"
PTAU_FILE="powersOfTau28_hez_final_15.ptau"  # 22MB, 支持 32K 约束 (本电路 ~12K)

# Check if circuit file exists
if [ ! -f "$CIRCUIT_FILE" ]; then
    echo "❌ Circuit file not found: $CIRCUIT_FILE"
    exit 1
fi

# Create output directory
mkdir -p "$OUT_DIR"

echo "📋 Configuration:"
echo "   Circuit: $CIRCUIT_FILE"
echo "   Output: $OUT_DIR"
echo "   PTAU: $PTAU_FILE"
echo ""

# Step 1: Compile circuit
echo "Step 1: Compiling circuit..."
circom "$CIRCUIT_FILE" \
    --r1cs \
    --wasm \
    --sym \
    --output "$OUT_DIR" \
    -l node_modules

if [ $? -eq 0 ]; then
    echo "✅ Circuit compiled successfully"
else
    echo "❌ Circuit compilation failed"
    exit 1
fi

# Extract constraint count
echo ""
echo "📊 Circuit Statistics:"
snarkjs r1cs info "${OUT_DIR}/${CIRCUIT_NAME}.r1cs" | grep -E "constraints|wires|inputs"
echo ""

# Step 2: Generate witness (for testing with dummy input)
echo "Step 2: Generating test witness..."
cat > "${OUT_DIR}/input_test.json" << EOF
{
    "root": "0",
    "nullifier": "0",
    "to": "0",
    "remintAmount": "0",
    "id": "0",
    "withdrawUnderlying": "0",
    "relayerDataHash": "0",
    "secret": "123456789",
    "addr20": "0",
    "commitAmount": "0",
    "q": "0",
    "pathElements": ["0","0","0","0","0","0","0","0","0","0","0","0","0","0","0","0","0","0","0","0"],
    "pathIndices": [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
}
EOF

node "${OUT_DIR}/${CIRCUIT_NAME}_js/generate_witness.js" \
    "${OUT_DIR}/${CIRCUIT_NAME}_js/${CIRCUIT_NAME}.wasm" \
    "${OUT_DIR}/input_test.json" \
    "${OUT_DIR}/witness_test.wtns"

if [ $? -eq 0 ]; then
    echo "✅ Test witness generated"
else
    echo "⚠️  Test witness generation failed (may be ok if inputs are invalid)"
fi

echo ""

# Step 3: Check PTAU file
if [ ! -f "$PTAU_FILE" ]; then
    echo "⚠️  PTAU file not found: $PTAU_FILE"
    echo "   Downloading PTAU 15 (22MB, supports up to 32K constraints)..."
    echo ""
    
    # Try to download automatically (using Google Cloud Storage mirror)
    if command -v curl &> /dev/null; then
        echo "   Using Google Cloud Storage mirror..."
        curl -L --max-time 120 "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_15.ptau" -o "$PTAU_FILE"
    elif command -v wget &> /dev/null; then
        echo "   Using Google Cloud Storage mirror..."
        wget --timeout=120 "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_15.ptau" -O "$PTAU_FILE"
    else
        echo "   Please download manually:"
        echo "   curl -L https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_15.ptau -o $PTAU_FILE"
        echo "   or"
        echo "   wget https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_15.ptau -O $PTAU_FILE"
        exit 1
    fi
    
    if [ ! -f "$PTAU_FILE" ]; then
        echo "❌ Download failed"
        exit 1
    fi
    echo "✅ PTAU file downloaded"
    echo ""
fi

# Continue with existing logic
if [ ! -f "$PTAU_FILE" ]; then
    echo "❌ PTAU file still not found"
    read -p "Continue without PTAU? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
    SKIP_SETUP=1
fi

if [ -z "$SKIP_SETUP" ]; then
    # Step 4: Groth16 setup
    echo "Step 4: Groth16 setup (this may take a while)..."
    snarkjs groth16 setup \
        "${OUT_DIR}/${CIRCUIT_NAME}.r1cs" \
        "$PTAU_FILE" \
        "${OUT_DIR}/${CIRCUIT_NAME}_0000.zkey"
    
    echo "✅ Setup complete"
    echo ""
    
    # Step 5: Contribute to ceremony
    echo "Step 5: Contributing to zKey..."
    echo "random entropy" | snarkjs zkey contribute \
        "${OUT_DIR}/${CIRCUIT_NAME}_0000.zkey" \
        "${OUT_DIR}/${CIRCUIT_NAME}_final.zkey" \
        --name="First contribution"
    
    echo "✅ Contribution complete"
    echo ""
    
    # Step 6: Export verification key
    echo "Step 6: Exporting verification key..."
    snarkjs zkey export verificationkey \
        "${OUT_DIR}/${CIRCUIT_NAME}_final.zkey" \
        "${OUT_DIR}/verification_key.json"
    
    echo "✅ Verification key exported"
    echo ""
    
    # Step 7: Generate Solidity verifier
    echo "Step 7: Generating Solidity verifier..."
    snarkjs zkey export solidityverifier \
        "${OUT_DIR}/${CIRCUIT_NAME}_final.zkey" \
        "contracts/Groth16Verifier.sol"
    
    echo "✅ Solidity verifier generated: contracts/Groth16Verifier.sol"
    echo ""
    
    # Step 8: File sizes
    echo "📦 Output Files:"
    ls -lh "${OUT_DIR}/${CIRCUIT_NAME}.r1cs" | awk '{print "   R1CS: " $5}'
    ls -lh "${OUT_DIR}/${CIRCUIT_NAME}_js/${CIRCUIT_NAME}.wasm" | awk '{print "   WASM: " $5}'
    ls -lh "${OUT_DIR}/${CIRCUIT_NAME}_final.zkey" | awk '{print "   zKey: " $5}'
    ls -lh "contracts/Groth16Verifier.sol" | awk '{print "   Verifier: " $5}'
    echo ""
fi

echo "🎉 Build complete!"
echo ""
echo "Next steps:"
echo "1. Deploy Groth16Verifier.sol"
echo "2. Deploy ZWERC20.sol with verifier address"
echo "3. Test with client/merkle_proof_frontend.js"
echo ""
echo "For testing:"
echo "  npx hardhat test test/claim_e2e.test.js"
echo ""

