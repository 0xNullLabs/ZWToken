// claim_from_state_root.circom (refined skeleton with placeholders)
// - addr20 = low160(Poseidon(MAGIC, secret)) with correctness: addrScalar == addr20 + q * TWO160
// - header binding (placeholder): headerHashCalc == headerHash, numberParsed == blockNumber, stateRootParsed == stateRoot
// - account/storage MPT (placeholder): storageRootWitness as account result; balance as storage result
// - amount <= balance (partial or full withdrawal allowed)
// - nullifier = Poseidon(secret, chainId, contractAddr)

pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom"; // Num2Bits
include "circomlib/circuits/comparators.circom"; // LessEqThan
// NOTE: RLP/Keccak/MPT components will be integrated here in a later step.

template ClaimFromStateRoot(DEPTH_ACCOUNT, DEPTH_STORAGE, MAGIC, TWO160) {
    // Public inputs
    signal input headerHash;        // keccak(RLP(header))
    signal input blockNumber;
    signal input stateRoot;         // must equal header.stateRoot
    signal input amount;            // claimed amount
    signal input nullifier;         // Poseidon(secret, chainId, contractAddr)
    signal input chainId;
    signal input contractAddr;      // ZWToken contract address
    signal input to;                // recipient address

    // Private inputs
    signal input secret;            // user secret
    signal input addr20;            // low 160 bits of Poseidon(MAGIC, secret)
    signal input q;                 // quotient for addr decomposition

    // Placeholder private inputs for future RLP/Keccak/MPT integration
    signal input headerHashCalc;    // should be keccak(RLP(header)) later
    signal input numberParsed;      // header.number
    signal input stateRootParsed;   // header.stateRoot
    signal input storageRootWitness;// account MPT -> storageRoot
    signal input balance;           // storage MPT -> balance (uint256 as field)

    // 0) Bind placeholders to public context (to be replaced by real components later)
    headerHash === headerHashCalc;
    blockNumber === numberParsed;
    stateRoot === stateRootParsed;

    // 1) addr20 = low160(Poseidon(MAGIC, secret)) with quotient constraint
    component posAddr = Poseidon(2);
    posAddr.inputs[0] <== MAGIC;
    posAddr.inputs[1] <== secret;
    signal addrScalar;
    addrScalar <== posAddr.out;

    // addr20 and q are private inputs (witnesses)
    component n2b = Num2Bits(160);
    n2b.in <== addr20;              // range constrain addr20 < 2^160
    addrScalar === addr20 + q * TWO160;

    // 2) Account/Storage placeholders (future proofs will feed storageRootWitness via account MPT)
    // signal storageRootDerived; // from account MPT; for now witness provided
    // storageRootDerived === storageRootWitness;

    // 3) amount <= balance (balance from storage MPT placeholder)
    component leq = LessEqThan(252); // 252 bits sufficient for most token amounts
    leq.in[0] <== amount;
    leq.in[1] <== balance;
    leq.out === 1; // enforce amount <= balance

    // 4) nullifier = Poseidon(secret, chainId, contractAddr)
    component posNullifier = Poseidon(3);
    posNullifier.inputs[0] <== secret;
    posNullifier.inputs[1] <== chainId;
    posNullifier.inputs[2] <== contractAddr;
    signal nf;
    nf <== posNullifier.out;
    nf === nullifier;
}

// Instantiate with placeholder MAGIC=0 and TWO160=2^160; replace MAGIC at compile time
component main {public [headerHash, blockNumber, stateRoot, amount, nullifier, chainId, contractAddr, to]} = ClaimFromStateRoot(8, 8, 0, 1461501637330902918203684832716283019655932542976);

