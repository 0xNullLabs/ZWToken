/**
 * Merkle Tree 工具类
 *
 * 提供 Incremental Poseidon Merkle Tree 的实现，
 * 用于 ZWERC20 的 commitment 管理和 proof 生成
 */

const { poseidon } = require("circomlibjs");

/**
 * Incremental Merkle Tree 实现（简化版）
 * 适用于浏览器端和测试环境
 */
class IncrementalMerkleTree {
  constructor(depth) {
    this.depth = depth;
    this.zeros = [];
    this.filledSubtrees = new Array(depth);
    this.leaves = [];
    this.nextIndex = 0;

    // 初始化 zero hashes
    let currentZero = 0n;
    this.zeros[0] = currentZero;
    for (let i = 1; i < depth; i++) {
      currentZero = poseidon([currentZero, currentZero]);
      this.zeros[i] = currentZero;
    }
    this.root = this.zeros[depth - 1];
  }

  /**
   * 插入叶子节点
   * @param {BigInt|string} leaf - 叶子节点值
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
   * 获取 Merkle proof
   * @param {number} index - 叶子节点索引
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

    return { root: this.root, pathElements, pathIndices };
  }

  /**
   * 重建子树的根哈希
   * @param {number} leafIndex - 子树起始叶子索引
   * @param {number} level - 子树的层级（0 = 叶子层）
   * @returns {BigInt} 子树根哈希
   */
  _reconstructSubtree(leafIndex, level) {
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
    const rightChild = this._reconstructSubtree(
      leafIndex + levelSize,
      level - 1
    );

    return poseidon([leftChild, rightChild]);
  }
}

/**
 * Poseidon Merkle Tree 实现（完整版）
 * 适用于合约存储客户端，支持完整的验证功能
 */
class PoseidonMerkleTree {
  constructor(depth, poseidonInstance) {
    this.depth = depth;
    this.poseidon = poseidonInstance;

    // 初始化零值哈希
    this.zeros = [];
    let currentZero = BigInt(0);
    this.zeros.push(currentZero);

    for (let i = 1; i < depth; i++) {
      const hash = this.hash(currentZero, currentZero);
      currentZero = BigInt(hash);
      this.zeros.push(currentZero);
    }

    // 存储叶子节点
    this.leaves = [];

    // 存储已填充的子树（用于增量更新）
    this.filledSubtrees = new Array(depth);
    for (let i = 0; i < depth; i++) {
      this.filledSubtrees[i] = this.zeros[i];
    }
  }

  /**
   * Poseidon 哈希函数
   */
  hash(left, right) {
    const result = this.poseidon([BigInt(left), BigInt(right)]);
    return this.poseidon.F.toString(result);
  }

  /**
   * 插入叶子节点
   */
  insert(leaf) {
    const index = this.leaves.length;
    if (index >= 2 ** this.depth) {
      throw new Error("Merkle tree is full");
    }

    this.leaves.push(BigInt(leaf));

    // 更新 filledSubtrees（与合约逻辑一致）
    let currentHash = BigInt(leaf);
    let currentIndex = index;

    for (let i = 0; i < this.depth; i++) {
      if (currentIndex % 2 === 0) {
        // 左子节点
        this.filledSubtrees[i] = currentHash;
        currentHash = BigInt(this.hash(currentHash, this.zeros[i]));
      } else {
        // 右子节点
        currentHash = BigInt(this.hash(this.filledSubtrees[i], currentHash));
      }
      currentIndex = Math.floor(currentIndex / 2);
    }

    return currentHash;
  }

  /**
   * 批量插入叶子节点
   */
  bulkInsert(leaves) {
    let lastRoot = null;
    for (const leaf of leaves) {
      lastRoot = this.insert(leaf);
    }
    return lastRoot;
  }

  /**
   * 获取当前 root
   */
  root() {
    if (this.leaves.length === 0) {
      return this.zeros[this.depth - 1];
    }

    // 重新计算 root（基于当前的 filledSubtrees）
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
   * 生成 Merkle proof
   * @param leafIndex 叶子节点的索引
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
        // 当前节点是左子节点，sibling 是右子节点
        const sibling =
          currentIndex + 1 < this.leaves.length && i === 0
            ? this.leaves[currentIndex + 1]
            : this.zeros[i];
        pathElements.push(sibling.toString());
        pathIndices.push(0);
      } else {
        // 当前节点是右子节点，sibling 是左子节点
        const sibling = this.filledSubtrees[i];
        pathElements.push(sibling.toString());
        pathIndices.push(1);
      }

      // 计算父节点哈希
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
   * 验证 Merkle proof
   */
  verifyProof(leaf, pathElements, pathIndices, root) {
    let currentHash = BigInt(leaf);

    for (let i = 0; i < this.depth; i++) {
      const sibling = BigInt(pathElements[i]);

      if (pathIndices[i] === 0) {
        // 当前节点是左子节点
        currentHash = BigInt(this.hash(currentHash, sibling));
      } else {
        // 当前节点是右子节点
        currentHash = BigInt(this.hash(sibling, currentHash));
      }
    }

    return currentHash.toString() === BigInt(root).toString();
  }
}

// 导出
module.exports = {
  IncrementalMerkleTree,
  PoseidonMerkleTree,
};
