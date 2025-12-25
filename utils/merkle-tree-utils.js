/**
 * Merkle Tree Utility Classes
 *
 * Provides Incremental Poseidon Merkle Tree implementation
 * for ZWERC20 commitment management and proof generation
 */

const { poseidon } = require("circomlibjs");

/**
 * Incremental Merkle Tree Implementation (Simplified Version)
 * Suitable for browser and test environments
 */
class IncrementalMerkleTree {
  constructor(depth) {
    this.depth = depth;
    this.zeros = [];
    this.filledSubtrees = new Array(depth);
    this.leaves = [];
    this.nextIndex = 0;

    // Initialize zero hashes
    let currentZero = 0n;
    this.zeros[0] = currentZero;
    for (let i = 1; i < depth; i++) {
      currentZero = poseidon([currentZero, currentZero]);
      this.zeros[i] = currentZero;
    }
    this.root = this.zeros[depth - 1];
  }

  /**
   * Insert a leaf node
   * @param {BigInt|string} leaf - Leaf node value
   */
  insert(leaf) {
    this.leaves.push(leaf);
    const index = this.nextIndex;
    let currentHash = BigInt(leaf);
    let currentIndex = index;

    for (let i = 0; i < this.depth; i++) {
      if (currentIndex % 2 === 0) {
        this.filledSubtrees[i] = currentHash;
        currentHash = poseidon([currentHash, this.zeros[i]]);
      } else {
        currentHash = poseidon([this.filledSubtrees[i], currentHash]);
      }
      currentIndex = Math.floor(currentIndex / 2);
    }

    this.root = currentHash;
    this.nextIndex++;
    return currentHash;
  }

  /**
   * Get Merkle proof
   * @param {number} index - Leaf node index
   * @returns {{root: BigInt, pathElements: BigInt[], pathIndices: number[]}}
   */
  getProof(index) {
    if (index >= this.nextIndex) {
      throw new Error("Index out of bounds");
    }

    const pathElements = [];
    const pathIndices = [];
    let currentIndex = index;

    for (let i = 0; i < this.depth; i++) {
      const isRight = currentIndex % 2 === 1;
      pathIndices.push(isRight ? 1 : 0);

      const levelSize = Math.pow(2, i);

      if (isRight) {
        // Current node is right child, need to compute left sibling
        // Note: Cannot use filledSubtrees[i] because it may have been overwritten
        // by subsequent insertions. Must reconstruct the actual sibling subtree.
        const siblingIndex = currentIndex - 1;
        const siblingLeafStart = siblingIndex * levelSize;
        pathElements.push(this._reconstructSubtree(siblingLeafStart, i));
      } else {
        // Current node is left child, need to compute right sibling
        const siblingIndex = currentIndex + 1;
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

    return { root: this.root, pathElements, pathIndices };
  }

  /**
   * Rebuild subtree root hash
   * @param {number} leafIndex - Subtree starting leaf index
   * @param {number} level - Subtree level (0 = leaf layer)
   * @returns {BigInt} Subtree root hash
   */
  _reconstructSubtree(leafIndex, level) {
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
    const rightChild = this._reconstructSubtree(
      leafIndex + levelSize,
      level - 1
    );

    return poseidon([leftChild, rightChild]);
  }
}

/**
 * Poseidon Merkle Tree Implementation (Full Version)
 * Suitable for contract storage clients, supports full verification functionality
 */
class PoseidonMerkleTree {
  constructor(depth, poseidonInstance) {
    this.depth = depth;
    this.poseidon = poseidonInstance;

    // Initialize zero value hashes
    this.zeros = [];
    let currentZero = BigInt(0);
    this.zeros.push(currentZero);

    for (let i = 1; i < depth; i++) {
      const hash = this.hash(currentZero, currentZero);
      currentZero = BigInt(hash);
      this.zeros.push(currentZero);
    }

    // Store leaf nodes
    this.leaves = [];

    // Store filled subtrees (for incremental updates)
    this.filledSubtrees = new Array(depth);
    for (let i = 0; i < depth; i++) {
      this.filledSubtrees[i] = this.zeros[i];
    }
  }

  /**
   * Poseidon hash function
   */
  hash(left, right) {
    const result = this.poseidon([BigInt(left), BigInt(right)]);
    return this.poseidon.F.toString(result);
  }

  /**
   * Insert a leaf node
   */
  insert(leaf) {
    const index = this.leaves.length;
    if (index >= 2 ** this.depth) {
      throw new Error("Merkle tree is full");
    }

    this.leaves.push(BigInt(leaf));

    // Update filledSubtrees (consistent with contract logic)
    let currentHash = BigInt(leaf);
    let currentIndex = index;

    for (let i = 0; i < this.depth; i++) {
      if (currentIndex % 2 === 0) {
        // Left child
        this.filledSubtrees[i] = currentHash;
        currentHash = BigInt(this.hash(currentHash, this.zeros[i]));
      } else {
        // Right child
        currentHash = BigInt(this.hash(this.filledSubtrees[i], currentHash));
      }
      currentIndex = Math.floor(currentIndex / 2);
    }

    return currentHash;
  }

  /**
   * Bulk insert leaf nodes
   */
  bulkInsert(leaves) {
    let lastRoot = null;
    for (const leaf of leaves) {
      lastRoot = this.insert(leaf);
    }
    return lastRoot;
  }

  /**
   * Get current root
   */
  root() {
    if (this.leaves.length === 0) {
      return this.zeros[this.depth - 1];
    }

    // Recompute root (based on current filledSubtrees)
    let currentHash = this.filledSubtrees[0];
    let currentIndex = this.leaves.length;

    for (let i = 0; i < this.depth; i++) {
      if (currentIndex % 2 === 0) {
        currentHash = BigInt(this.hash(currentHash, this.zeros[i]));
      } else {
        currentHash = BigInt(this.hash(this.filledSubtrees[i], currentHash));
      }
      currentIndex = Math.floor(currentIndex / 2);
    }

    return currentHash;
  }

  /**
   * Generate Merkle proof
   * @param leafIndex Leaf node index
   * @returns { pathElements, pathIndices, root, leaf }
   */
  generateProof(leafIndex) {
    if (leafIndex >= this.leaves.length) {
      throw new Error("Leaf index out of bounds");
    }

    const pathElements = [];
    const pathIndices = [];
    let currentIndex = leafIndex;
    let currentHash = this.leaves[leafIndex];

    for (let i = 0; i < this.depth; i++) {
      const isLeft = currentIndex % 2 === 0;

      if (isLeft) {
        // Current node is left child, sibling is right child
        const sibling =
          currentIndex + 1 < this.leaves.length && i === 0
            ? this.leaves[currentIndex + 1]
            : this.zeros[i];
        pathElements.push(sibling.toString());
        pathIndices.push(0);
      } else {
        // Current node is right child, sibling is left child
        const sibling = this.filledSubtrees[i];
        pathElements.push(sibling.toString());
        pathIndices.push(1);
      }

      // Compute parent node hash
      if (isLeft) {
        currentHash = BigInt(this.hash(currentHash, pathElements[i]));
      } else {
        currentHash = BigInt(this.hash(pathElements[i], currentHash));
      }

      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      pathElements,
      pathIndices,
      root: this.root().toString(),
      leaf: this.leaves[leafIndex].toString(),
    };
  }

  /**
   * Verify Merkle proof
   */
  verifyProof(leaf, pathElements, pathIndices, root) {
    let currentHash = BigInt(leaf);

    for (let i = 0; i < this.depth; i++) {
      const sibling = BigInt(pathElements[i]);

      if (pathIndices[i] === 0) {
        // Current node is left child
        currentHash = BigInt(this.hash(currentHash, sibling));
      } else {
        // Current node is right child
        currentHash = BigInt(this.hash(sibling, currentHash));
      }
    }

    return currentHash.toString() === BigInt(root).toString();
  }
}

// Export
module.exports = {
  IncrementalMerkleTree,
  PoseidonMerkleTree,
};
