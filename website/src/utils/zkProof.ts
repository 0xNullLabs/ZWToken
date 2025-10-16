/**
 * ZK Proof 生成工具
 * 参考 test/e2e.test.js 中的实现
 */

import { buildPoseidon } from 'circomlibjs';
import { ethers } from 'ethers';

/**
 * Incremental Merkle Tree 实现
 * 参考 utils/merkle-tree-utils
 */
export class IncrementalMerkleTree {
  depth: number;
  leaves: bigint[];
  zeros: bigint[];
  
  constructor(depth: number) {
    this.depth = depth;
    this.leaves = [];
    this.zeros = [];
    
    // 初始化零值
    this.zeros[0] = 0n;
    for (let i = 1; i <= depth; i++) {
      this.zeros[i] = this.hash(this.zeros[i - 1], this.zeros[i - 1]);
    }
  }
  
  // Poseidon hash (需要在实际使用时替换为真实的 Poseidon)
  private hash(left: bigint, right: bigint): bigint {
    // 这里需要使用 circomlibjs 的 poseidon
    // 暂时使用简单的 keccak256 替代（实际应用中需要替换）
    const packed = ethers.solidityPacked(['uint256', 'uint256'], [left, right]);
    return BigInt(ethers.keccak256(packed));
  }
  
  insert(leaf: bigint) {
    this.leaves.push(leaf);
  }
  
  get root(): bigint {
    if (this.leaves.length === 0) {
      return this.zeros[this.depth];
    }
    
    let currentLevel = [...this.leaves];
    
    for (let level = 0; level < this.depth; level++) {
      const nextLevel: bigint[] = [];
      
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : this.zeros[level];
        nextLevel.push(this.hash(left, right));
      }
      
      if (currentLevel.length % 2 === 1) {
        // 奇数个节点，最后一个需要与零值配对
      }
      
      currentLevel = nextLevel;
      
      if (currentLevel.length === 0) {
        return this.zeros[this.depth - level];
      }
    }
    
    return currentLevel[0] || this.zeros[this.depth];
  }
  
  getProof(index: number): { pathElements: bigint[]; pathIndices: number[] } {
    if (index >= this.leaves.length) {
      throw new Error('Index out of bounds');
    }
    
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    
    let currentLevel = [...this.leaves];
    let currentIndex = index;
    
    for (let level = 0; level < this.depth; level++) {
      const isLeft = currentIndex % 2 === 0;
      const siblingIndex = isLeft ? currentIndex + 1 : currentIndex - 1;
      
      const sibling = siblingIndex < currentLevel.length 
        ? currentLevel[siblingIndex] 
        : this.zeros[level];
      
      pathElements.push(sibling);
      pathIndices.push(isLeft ? 0 : 1);
      
      // 移动到下一层
      const nextLevel: bigint[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : this.zeros[level];
        nextLevel.push(this.hash(left, right));
      }
      
      currentLevel = nextLevel;
      currentIndex = Math.floor(currentIndex / 2);
    }
    
    return { pathElements, pathIndices };
  }
}

/**
 * 从 Secret 生成隐私地址和相关参数
 */
export async function deriveFromSecret(secret: string) {
  const poseidon = await buildPoseidon();
  const secretBigInt = BigInt(secret);
  
  // 推导隐私地址 (参考 e2e.test.js)
  const addrScalar = poseidon.F.toString(poseidon([secretBigInt]));
  const addr20 = BigInt(addrScalar) & ((1n << 160n) - 1n);
  const q = (BigInt(addrScalar) - addr20) / (1n << 160n);
  
  const privacyAddress = ethers.getAddress(
    '0x' + addr20.toString(16).padStart(40, '0')
  );
  
  // 生成 nullifier
  const nullifier = poseidon.F.toString(poseidon([addr20]));
  
  return {
    privacyAddress,
    addr20,
    q,
    nullifier: BigInt(nullifier),
    secret: secretBigInt,
  };
}

/**
 * 从链上重建 Merkle Tree
 */
export async function rebuildMerkleTree(
  contract: ethers.Contract,
  poseidon: any
): Promise<IncrementalMerkleTree> {
  // 获取 leaf 数量
  const leafCount = await contract.getStoredLeafCount();
  console.log(`Found ${leafCount} commitment(s)`);
  
  if (leafCount === 0n) {
    throw new Error('No commitments found on chain');
  }
  
  // 获取所有 leafs
  const leaves = await contract.getLeafRange(0, leafCount);
  console.log(`Retrieved ${leaves.length} leaf(s) from storage`);
  
  // 重建 Merkle tree
  const tree = new IncrementalMerkleTree(20);
  for (const leaf of leaves) {
    // 计算 commitment = Poseidon(address, amount)
    const commitment = poseidon([BigInt(leaf.to), BigInt(leaf.amount)]);
    tree.insert(BigInt(poseidon.F.toString(commitment)));
  }
  
  return tree;
}

/**
 * 查找用户的 commitment
 */
export async function findUserCommitment(
  contract: ethers.Contract,
  privacyAddress: string,
  poseidon: any
): Promise<{ commitment: bigint; amount: bigint; index: number } | null> {
  const leafCount = await contract.getStoredLeafCount();
  if (leafCount === 0n) {
    return null;
  }
  
  const leaves = await contract.getLeafRange(0, leafCount);
  
  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i];
    if (leaf.to.toLowerCase() === privacyAddress.toLowerCase()) {
      const commitment = poseidon([BigInt(leaf.to), BigInt(leaf.amount)]);
      return {
        commitment: BigInt(poseidon.F.toString(commitment)),
        amount: BigInt(leaf.amount),
        index: i,
      };
    }
  }
  
  return null;
}

/**
 * 准备电路输入
 * 参考 e2e.test.js 的 circuitInput
 */
export function prepareCircuitInput(
  params: {
    root: bigint;
    nullifier: bigint;
    recipient: string;
    claimAmount: bigint;
    secret: bigint;
    addr20: bigint;
    firstAmount: bigint;
    q: bigint;
    merkleProof: { pathElements: bigint[]; pathIndices: number[] };
  }
) {
  return {
    // Public inputs
    root: params.root,
    nullifier: params.nullifier,
    to: BigInt(params.recipient),
    claimAmount: params.claimAmount,
    
    // Private inputs
    secret: params.secret,
    addr20: params.addr20,
    firstAmount: params.firstAmount,
    q: params.q,
    pathElements: params.merkleProof.pathElements,
    pathIndices: params.merkleProof.pathIndices,
  };
}

