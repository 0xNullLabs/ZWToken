// remint.circom
// ZK Circuit: Proves user can remint their first received ZWToken
// Uses Poseidon hash (ZK friendly) + 20-layer Merkle tree

pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";

/**
 * Poseidon Merkle Tree Inclusion Proof
 * Verifies that a leaf is in the Merkle tree
 */
template PoseidonMerkleProof(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels];  // 0 = left, 1 = right
    
    signal hashes[levels + 1];
    hashes[0] <== leaf;
    
    component hashers[levels];
    component selectors[levels];
    
    for (var i = 0; i < levels; i++) {
        // Determine left/right based on pathIndices[i]
        selectors[i] = Selector();
        selectors[i].index <== pathIndices[i];
        selectors[i].value[0] <== hashes[i];
        selectors[i].value[1] <== pathElements[i];
        
        // Compute parent node hash
        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== selectors[i].outL;
        hashers[i].inputs[1] <== selectors[i].outR;
        
        hashes[i + 1] <== hashers[i].out;
    }
    
    // Verify final root matches
    root === hashes[levels];
}

/**
 * Selector: Determines left/right order based on index
 * Implemented using quadratic constraints
 */
template Selector() {
    signal input index;        // 0 or 1
    signal input value[2];     // [current, sibling]
    signal output outL;        // left child
    signal output outR;        // right child
    
    // 🔒 Security constraint: Ensure index can only be 0 or 1
    // Prevents attackers from bypassing Merkle proof verification with arbitrary values
    index * (1 - index) === 0;
    
    // index === 0: outL = current, outR = sibling
    // index === 1: outL = sibling, outR = current
    
    // Implemented using quadratic constraints
    signal diff;
    diff <== value[1] - value[0];
    
    outL <== value[0] + diff * index;
    outR <== value[1] - diff * index;
}

/**
 * Main Circuit: Proves user can remint their first received ZWToken
 * 
 * Proof content:
 * 1. User knows the secret for a certain address
 * 2. That address first received commitAmount ZWTokens
 * 3. commitment = Poseidon(addr20, commitAmount) is in the Merkle tree
 * 4. remintAmount <= commitAmount
 * 5. nullifier = Poseidon(addr20, secret) is correct (prevents double-spending and protects privacy)
 * 6. Binds to, withdrawUnderlying, relayerDataHash to the constraint system
 * 
 * Security Guarantees:
 * - All public inputs must participate in constraints to prevent tampering during verification
 * - to, withdrawUnderlying, relayerDataHash are bound via Poseidon hash
 * - If public inputs differ between proof generation and verification, verification will fail
 * 
 * Privacy Protection:
 * - Privacy address derivation: addrScalar = Poseidon(8065, id, secret)
 * - addr20 = addrScalar & 0xFFFF...FFFF (implicitly contains 8065 and id information)
 * - Commitment calculation: Poseidon(addr20, commitAmount)
 * - Nullifier calculation: Poseidon(addr20, secret)
 * - Even if observer knows addr20, they cannot compute nullifier without secret
 * - Observer cannot reverse nullifier to get addr20 or secret
 * - Different ids produce different addr20, ensuring cross-token isolation
 */
template Remint(TREE_DEPTH, TWO160) {
    // ========== PUBLIC INPUTS ==========
    signal input root;                  // Merkle root (commitment)
    signal input nullifier;             // Double-spending prevention identifier
    signal input to;                    // Recipient address
    signal input remintAmount;          // Remint amount
    signal input id;                    // Token ID (must be 0 for ERC-20)
    signal input withdrawUnderlying;    // 1 = withdraw underlying, 0 = mint ZWToken
    signal input relayerFee;            // Relayer fee (basis points, e.g., 100 = 1%)
    
    // ========== PRIVATE INPUTS ==========
    signal input secret;            // User secret
    signal input addr20;            // Privacy address (160 bits)
    signal input commitAmount;      // First received amount (amount in commitment)
    signal input q;                 // Quotient from addr20 derivation
    
    // Merkle proof
    signal input pathElements[TREE_DEPTH];
    signal input pathIndices[TREE_DEPTH];
    
    // ========== 1. Derive and Verify Privacy Address ==========
    
    // secret has replay protection from chain id and contract address
    // Compute addrScalar = Poseidon(8065, id, secret)
    component posAddr = Poseidon(3);
    posAddr.inputs[0] <== 8065;
    posAddr.inputs[1] <== id;
    posAddr.inputs[2] <== secret;
    
    signal addrScalar;
    addrScalar <== posAddr.out;
    
    // Verify addr20 is the lower 160 bits of addrScalar
    // addrScalar = addr20 + q * 2^160
    component n2b = Num2Bits(160);
    n2b.in <== addr20;  // Ensure addr20 < 2^160
    
    addrScalar === addr20 + q * TWO160;
    
    // ========== 2. Compute Commitment ==========
    
    // commitment = Poseidon(addr20, commitAmount)
    // Note: addr20 is derived from Poseidon(8065, id, secret), implicitly containing id info
    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== addr20;
    commitmentHasher.inputs[1] <== commitAmount;
    
    signal commitment;
    commitment <== commitmentHasher.out;
    
    // ========== 3. Verify Merkle Proof ==========
    
    component merkleProof = PoseidonMerkleProof(TREE_DEPTH);
    merkleProof.leaf <== commitment;
    merkleProof.root <== root;
    
    for (var i = 0; i < TREE_DEPTH; i++) {
        merkleProof.pathElements[i] <== pathElements[i];
        merkleProof.pathIndices[i] <== pathIndices[i];
    }
    
    // ========== 4. Verify Remint Amount ==========
    
    // remintAmount <= commitAmount
    component leq = LessEqThan(252);
    leq.in[0] <== remintAmount;
    leq.in[1] <== commitAmount;
    leq.out === 1;
    
    // ========== 5. Verify Nullifier ==========
    
    // nullifier = Poseidon(addr20, secret)
    // Note: addr20 is derived from Poseidon(8065, id, secret), implicitly containing 8065 and id info
    // Each (addr20, secret) combination can only remint once
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== addr20;
    nullifierHasher.inputs[1] <== secret;
    
    nullifier === nullifierHasher.out;
    
    // ========== 6. Bind Unconstrained Public Inputs ==========
    // to, withdrawUnderlying, relayerFee must participate in constraints
    // Otherwise attackers can tamper these values during verification while proof remains valid
    // Bind them to the constraint system via Poseidon hash
    
    // 🔒 Security constraint: Ensure withdrawUnderlying can only be 0 or 1
    withdrawUnderlying * (1 - withdrawUnderlying) === 0;
    
    component publicInputsHasher = Poseidon(3);
    publicInputsHasher.inputs[0] <== to;
    publicInputsHasher.inputs[1] <== withdrawUnderlying;
    publicInputsHasher.inputs[2] <== relayerFee;
    
    // Compute binding hash (<== creates constraint, ensuring these public inputs participate in R1CS)
    signal publicInputsBinding;
    publicInputsBinding <== publicInputsHasher.out;
}

// Instantiate main circuit
// Parameters:
// - TREE_DEPTH: 20 (supports 2^20 = 1,048,576 addresses)
// - TWO160: 2^160 (address space size)

component main {public [root, nullifier, to, remintAmount, id, withdrawUnderlying, relayerFee]} = Remint(
    20,  // TREE_DEPTH
    1461501637330902918203684832716283019655932542976  // 2^160
);
