/**
 * ZK Proof 生成工具
 * 参考 test/e2e.test.js 中的实现
 */

import { buildPoseidon } from 'circomlibjs';
import { ethers } from 'ethers';

/**
 * Incremental Merkle Tree 实现
 * 使用 Poseidon hash（与合约和 e2e 测试一致）
 */
export class IncrementalMerkleTree {
  depth: number;
  zeros: bigint[];
  filledSubtrees: bigint[];
  leaves: bigint[];
  nextIndex: number;
  root: bigint;
  poseidon: any;

  constructor(depth: number, poseidon: any) {
    this.depth = depth;
    this.zeros = [];
    this.filledSubtrees = new Array(depth);
    this.leaves = [];
    this.nextIndex = 0;
    this.poseidon = poseidon;

    // 初始化零值（使用 Poseidon hash）
    let currentZero = 0n;
    this.zeros[0] = currentZero;
    for (let i = 1; i < depth; i++) {
      currentZero = this.hash(currentZero, currentZero);
      this.zeros[i] = currentZero;
    }
    this.root = this.zeros[depth - 1];
  }

  // Poseidon hash（使用 circomlibjs）
  private hash(left: bigint, right: bigint): bigint {
    const result = this.poseidon([left, right]);
    return BigInt(this.poseidon.F.toString(result));
  }

  insert(leaf: bigint) {
    this.leaves.push(leaf);
    const index = this.nextIndex;
    let currentHash = BigInt(leaf);
    let currentIndex = index;

    for (let i = 0; i < this.depth; i++) {
      if (currentIndex % 2 === 0) {
        this.filledSubtrees[i] = currentHash;
        currentHash = this.hash(currentHash, this.zeros[i]);
      } else {
        currentHash = this.hash(this.filledSubtrees[i], currentHash);
      }
      currentIndex = Math.floor(currentIndex / 2);
    }

    this.root = currentHash;
    this.nextIndex++;
    return currentHash;
  }

  getProof(index: number): { pathElements: bigint[]; pathIndices: number[] } {
    if (index >= this.nextIndex) {
      throw new Error('Index out of bounds');
    }

    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let currentIndex = index;

    for (let i = 0; i < this.depth; i++) {
      const isRight = currentIndex % 2 === 1;
      pathIndices.push(isRight ? 1 : 0);

      if (isRight) {
        // 当前节点是右子节点，sibling 是 filledSubtrees[i]
        pathElements.push(this.filledSubtrees[i] || this.zeros[i]);
      } else {
        // 当前节点是左子节点，需要计算右侧 sibling
        const siblingIndex = currentIndex + 1;
        const levelSize = Math.pow(2, i);
        const siblingLeafStart = siblingIndex * levelSize;

        if (siblingLeafStart < this.nextIndex) {
          // 有真实的右兄弟，需要重建它的子树
          pathElements.push(this._reconstructSubtree(siblingLeafStart, i));
        } else {
          // 没有右兄弟，使用 zero
          pathElements.push(this.zeros[i]);
        }
      }
      currentIndex = Math.floor(currentIndex / 2);
    }

    return { pathElements, pathIndices };
  }

  /**
   * 重建子树的根哈希
   */
  private _reconstructSubtree(leafIndex: number, level: number): bigint {
    if (level === 0) {
      // 叶子层
      if (leafIndex < this.leaves.length) {
        return BigInt(this.leaves[leafIndex]);
      } else {
        return this.zeros[0];
      }
    }

    // 递归构建左右子树
    const levelSize = Math.pow(2, level - 1);
    const leftChild = this._reconstructSubtree(leafIndex, level - 1);
    const rightChild = this._reconstructSubtree(leafIndex + levelSize, level - 1);

    return this.hash(leftChild, rightChild);
  }
}

/**
 * 从 Secret 生成隐私地址和相关参数
 * @param secret 用户秘密
 * @param tokenId Token ID (0 for ERC-20)
 */
export async function deriveFromSecret(secret: string, tokenId: bigint = 0n) {
  const poseidon = await buildPoseidon();
  const secretBigInt = BigInt(secret);

  // 推导隐私地址：addrScalar = Poseidon(8065, tokenId, secret)
  const addrScalar = poseidon.F.toString(poseidon([8065n, tokenId, secretBigInt]));
  const addr20 = BigInt(addrScalar) & ((1n << 160n) - 1n);
  const q = (BigInt(addrScalar) - addr20) / (1n << 160n);

  const privacyAddress = ethers.getAddress('0x' + addr20.toString(16).padStart(40, '0'));

  // 生成 nullifier = Poseidon(addr20, secret)
  const nullifier = poseidon.F.toString(poseidon([addr20, secretBigInt]));

  return {
    privacyAddress,
    addr20,
    q,
    nullifier: BigInt(nullifier),
    secret: secretBigInt,
    tokenId,
  };
}

/**
 * 分批获取链上的leafs（使用 getCommitLeaves API）
 * @param contract 合约实例
 * @param tokenId Token ID (ERC-20 固定为 0)
 * @param startIndex 起始索引
 * @param totalCount 总数量
 * @param batchSize 每批数量（默认100）
 * @returns Array of {to, amount} objects
 */
export async function getCommitLeavesInBatches(
  contract: ethers.Contract,
  tokenId: number,
  startIndex: number,
  totalCount: bigint,
  batchSize: number = 100,
): Promise<Array<{ to: string; amount: bigint }>> {
  const allLeaves: Array<{ to: string; amount: bigint }> = [];
  const total = Number(totalCount);

  for (let i = startIndex; i < total; i += batchSize) {
    const length = Math.min(batchSize, total - i);
    console.log(`Fetching leaves ${i} to ${i + length - 1}...`);
    const [commitHashes, recipients, amounts] = await contract.getCommitLeaves(tokenId, i, length);
    
    // Reconstruct leaf objects from three arrays
    for (let j = 0; j < recipients.length; j++) {
      allLeaves.push({
        to: recipients[j],
        amount: amounts[j],
      });
    }
  }

  return allLeaves;
}

/**
 * 从链上重建 Merkle Tree
 * 与 e2e.test.js 逻辑完全一致
 */
export async function rebuildMerkleTree(
  contract: ethers.Contract,
  poseidon: any,
  tokenId: number = 0,
): Promise<IncrementalMerkleTree> {
  // 获取 leaf 数量
  const leafCount = await contract.getCommitLeafCount(0);
  console.log(`Found ${leafCount} commitment(s)`);

  if (leafCount === 0n) {
    throw new Error('No commitments found on chain');
  }

  // 分批获取所有 leafs
  const leaves = await getCommitLeavesInBatches(contract, 0, leafCount, 100);
  console.log(`Retrieved ${leaves.length} leaf(s) from storage`);

  // 重建 Merkle tree（传入 poseidon 实例）
  const tree = new IncrementalMerkleTree(20, poseidon);
  for (const leaf of leaves) {
    // 计算 commitment = Poseidon(address, amount)
    // 注意：这里直接使用 poseidon() 的返回值，它已经是 Field 元素
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
  poseidon: any,
): Promise<{ commitment: bigint; amount: bigint; index: number } | null> {
  const leafCount = await contract.getCommitLeafCount(0);
  if (leafCount === 0n) {
    return null;
  }

  // 分批获取所有 leafs
  const leaves = await getCommitLeavesInBatches(contract, 0, leafCount, 100);

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
 * 准备电路输入 (IERC8065 版本)
 * 参考 IERC8065 规范和更新后的电路
 */
export function prepareCircuitInput(params: {
  root: bigint;
  nullifier: bigint;
  recipient: string;
  remintAmount: bigint;
  id?: bigint; // Token ID (default 0 for ERC-20)
  withdrawUnderlying?: boolean; // Default false
  relayerFee?: bigint; // Default 0
  secret: bigint;
  addr20: bigint;
  commitAmount: bigint;
  q: bigint;
  merkleProof: { pathElements: bigint[]; pathIndices: number[] };
}) {
  return {
    // Public inputs (7 total for IERC8065)
    root: params.root,
    nullifier: params.nullifier,
    to: BigInt(params.recipient),
    remintAmount: params.remintAmount,
    id: params.id ?? 0n, // Default to 0 for ERC-20
    withdrawUnderlying: params.withdrawUnderlying ? 1n : 0n, // Convert boolean to 0/1
    relayerFee: params.relayerFee ?? 0n, // Default to 0

    // Private inputs
    secret: params.secret,
    addr20: params.addr20,
    commitAmount: params.commitAmount,
    q: params.q,
    pathElements: params.merkleProof.pathElements,
    pathIndices: params.merkleProof.pathIndices,
  };
}
