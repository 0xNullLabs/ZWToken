// claim_first_receipt.circom
// ZK 电路：证明用户首次接收的 ZWToken commitment
// 使用 Poseidon hash（ZK 友好）+ 20 层 Merkle tree

pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";

/**
 * Poseidon Merkle Tree 包含性证明
 * 验证某个 leaf 在 Merkle tree 中
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
        // 根据 pathIndices[i] 决定 left/right
        selectors[i] = Selector();
        selectors[i].index <== pathIndices[i];
        selectors[i].value[0] <== hashes[i];
        selectors[i].value[1] <== pathElements[i];
        
        // 计算父节点哈希
        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== selectors[i].outL;
        hashers[i].inputs[1] <== selectors[i].outR;
        
        hashes[i + 1] <== hashers[i].out;
    }
    
    // 验证最终 root 匹配
    root === hashes[levels];
}

/**
 * 选择器：根据 index 决定 left/right 顺序
 * 使用二次约束实现
 */
template Selector() {
    signal input index;        // 0 or 1
    signal input value[2];     // [current, sibling]
    signal output outL;        // left child
    signal output outR;        // right child
    
    // index === 0: outL = current, outR = sibling
    // index === 1: outL = sibling, outR = current
    
    // 使用二次约束实现
    signal diff;
    diff <== value[1] - value[0];
    
    outL <== value[0] + diff * index;
    outR <== value[1] - diff * index;
}

/**
 * 主电路：证明用户可以 claim 其首次接收的 ZWToken
 * 
 * 证明内容：
 * 1. 用户知道某个地址的 secret
 * 2. 该地址首次接收了 firstAmount 个 ZWToken
 * 3. commitment = Poseidon(addr20, firstAmount) 在 Merkle tree 中
 * 4. claimAmount <= firstAmount
 * 5. nullifier = Poseidon(addr20, secret) 正确（防双花且保护隐私）
 * 
 * 隐私保护：
 * - nullifier 使用 (addr20, secret) 两个输入计算
 * - 避免 nullifier == addrScalar 导致的隐私泄漏
 * - 观察者即使知道 addr20，不知道 secret 也无法计算 nullifier
 * - 观察者无法从 nullifier 反推出 addr20 或 secret
 */
template ClaimFirstReceipt(TREE_DEPTH, TWO160) {
    // ========== PUBLIC INPUTS ==========
    signal input root;              // Merkle root
    signal input nullifier;         // 防双花标识
    signal input to;                // 接收地址
    signal input claimAmount;       // 提现金额
    
    // ========== PRIVATE INPUTS ==========
    signal input secret;            // 用户秘密
    signal input addr20;            // 隐私地址（160 bits）
    signal input firstAmount;       // 首次接收金额
    signal input q;                 // addr20 推导的商
    
    // Merkle proof
    signal input pathElements[TREE_DEPTH];
    signal input pathIndices[TREE_DEPTH];
    
    // ========== 1. 推导和验证隐私地址 ==========
    
    // 计算 addrScalar = Poseidon(secret)
    component posAddr = Poseidon(1);
    posAddr.inputs[0] <== secret;
    
    signal addrScalar;
    addrScalar <== posAddr.out;
    
    // 验证 addr20 是 addrScalar 的低 160 位
    // addrScalar = addr20 + q * 2^160
    component n2b = Num2Bits(160);
    n2b.in <== addr20;  // 确保 addr20 < 2^160
    
    addrScalar === addr20 + q * TWO160;
    
    // ========== 2. 计算 Commitment ==========
    
    // commitment = Poseidon(addr20, firstAmount)
    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== addr20;
    commitmentHasher.inputs[1] <== firstAmount;
    
    signal commitment;
    commitment <== commitmentHasher.out;
    
    // ========== 3. 验证 Merkle Proof ==========
    
    component merkleProof = PoseidonMerkleProof(TREE_DEPTH);
    merkleProof.leaf <== commitment;
    merkleProof.root <== root;
    
    for (var i = 0; i < TREE_DEPTH; i++) {
        merkleProof.pathElements[i] <== pathElements[i];
        merkleProof.pathIndices[i] <== pathIndices[i];
    }
    
    // ========== 4. 验证提现金额 ==========
    
    // claimAmount <= firstAmount
    component leq = LessEqThan(252);
    leq.in[0] <== claimAmount;
    leq.in[1] <== firstAmount;
    leq.out === 1;
    
    // ========== 5. 验证 Nullifier ==========
    
    // nullifier = Poseidon(addr20, secret)
    // 注意：每个 (addr20, secret) 组合只能 claim 一次
    // 使用两个输入，防止 nullifier == addrScalar 导致的隐私泄漏
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== addr20;
    nullifierHasher.inputs[1] <== secret;
    
    nullifier === nullifierHasher.out;
}

// 实例化主电路
// 参数：
// - TREE_DEPTH: 20（支持 2^20 = 1,048,576 个地址）
// - TWO160: 2^160（地址空间大小）

component main {public [root, nullifier, to, claimAmount]} = ClaimFirstReceipt(
    20,  // TREE_DEPTH
    1461501637330902918203684832716283019655932542976  // 2^160
);

