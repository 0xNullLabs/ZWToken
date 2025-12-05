/**
 * ZK Proof Generation Utility
 * Reference: test/e2e.test.js implementation
 */

import { buildPoseidon } from 'circomlibjs';
import { ethers } from 'ethers';

/**
 * Incremental Merkle Tree Implementation
 * Uses Poseidon hash (consistent with contract and e2e tests)
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

    // Initialize zero values (using Poseidon hash)
    let currentZero = 0n;
    this.zeros[0] = currentZero;
    for (let i = 1; i < depth; i++) {
      currentZero = this.hash(currentZero, currentZero);
      this.zeros[i] = currentZero;
    }
    this.root = this.zeros[depth - 1];
  }

  // Poseidon hash (using circomlibjs)
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
        // Current node is right child, sibling is filledSubtrees[i]
        pathElements.push(this.filledSubtrees[i] || this.zeros[i]);
      } else {
        // Current node is left child, need to compute right sibling
        const siblingIndex = currentIndex + 1;
        const levelSize = Math.pow(2, i);
        const siblingLeafStart = siblingIndex * levelSize;

        if (siblingLeafStart < this.nextIndex) {
          // Has real right sibling, need to rebuild its subtree
          pathElements.push(this._reconstructSubtree(siblingLeafStart, i));
        } else {
          // No right sibling, use zero
          pathElements.push(this.zeros[i]);
        }
      }
      currentIndex = Math.floor(currentIndex / 2);
    }

    return { pathElements, pathIndices };
  }

  /**
   * Rebuild subtree root hash
   */
  private _reconstructSubtree(leafIndex: number, level: number): bigint {
    if (level === 0) {
      // Leaf layer
      if (leafIndex < this.leaves.length) {
        return BigInt(this.leaves[leafIndex]);
      } else {
        return this.zeros[0];
      }
    }

    // Recursively build left and right subtrees
    const levelSize = Math.pow(2, level - 1);
    const leftChild = this._reconstructSubtree(leafIndex, level - 1);
    const rightChild = this._reconstructSubtree(leafIndex + levelSize, level - 1);

    return this.hash(leftChild, rightChild);
  }
}

/**
 * Derive privacy address and related parameters from Secret
 * @param secret User secret
 * @param tokenId Token ID (0 for ERC-20)
 */
export async function deriveFromSecret(secret: string, tokenId: bigint = 0n) {
  const poseidon = await buildPoseidon();
  const secretBigInt = BigInt(secret);

  // Derive privacy address: addrScalar = Poseidon(8065, tokenId, secret)
  const addrScalar = poseidon.F.toString(poseidon([8065n, tokenId, secretBigInt]));
  const addr20 = BigInt(addrScalar) & ((1n << 160n) - 1n);
  const q = (BigInt(addrScalar) - addr20) / (1n << 160n);

  const privacyAddress = ethers.getAddress('0x' + addr20.toString(16).padStart(40, '0'));

  // Generate nullifier = Poseidon(addr20, secret)
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
 * Fetch leaves from chain in batches (using getCommitLeaves API)
 * @param contract Contract instance
 * @param tokenId Token ID (ERC-20 fixed to 0)
 * @param startIndex Start index
 * @param totalCount Total count
 * @param batchSize Batch size (default 100)
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
 * Rebuild Merkle Tree from on-chain data
 * Consistent with e2e.test.js logic
 */
export async function rebuildMerkleTree(
  contract: ethers.Contract,
  poseidon: any,
  tokenId: number = 0,
): Promise<IncrementalMerkleTree> {
  // Get leaf count
  const leafCount = await contract.getCommitLeafCount(0);
  console.log(`Found ${leafCount} commitment(s)`);

  if (leafCount === 0n) {
    throw new Error('No commitments found on chain');
  }

  // Fetch all leaves in batches
  const leaves = await getCommitLeavesInBatches(contract, 0, 0, leafCount, 100);
  console.log(`Retrieved ${leaves.length} leaf(s) from storage`);

  // Rebuild Merkle tree (pass poseidon instance)
  const tree = new IncrementalMerkleTree(20, poseidon);
  for (const leaf of leaves) {
    // Compute commitment = Poseidon(address, amount)
    // Note: poseidon() returns a Field element directly
    const commitment = poseidon([BigInt(leaf.to), BigInt(leaf.amount)]);
    tree.insert(BigInt(poseidon.F.toString(commitment)));
  }

  return tree;
}

/**
 * Find user's commitment
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

  // Fetch all leaves in batches
  const leaves = await getCommitLeavesInBatches(contract, 0, 0, leafCount, 100);

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
 * Prepare circuit input (IERC8065 version)
 * Reference: IERC8065 specification and updated circuit
 */
export function prepareCircuitInput(params: {
  root: bigint;
  nullifier: bigint;
  recipient: string;
  remintAmount: bigint;
  id?: bigint; // Token ID (default 0 for ERC-20)
  withdrawUnderlying?: boolean; // Default false
  relayerFee?: bigint; // Relayer fee in basis points (default 0)
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
    relayerFee: params.relayerFee ?? 0n, // Relayer fee (basis points)

    // Private inputs
    secret: params.secret,
    addr20: params.addr20,
    commitAmount: params.commitAmount,
    q: params.q,
    pathElements: params.merkleProof.pathElements,
    pathIndices: params.merkleProof.pathIndices,
  };
}
