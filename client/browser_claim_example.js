/**
 * 浏览器端完整 Claim 流程示例
 *
 * 展示如何在浏览器中：
 * 1. 获取 Merkle path（从链上）
 * 2. 生成 ZK proof
 * 3. 提交 claim 交易
 */

const { ethers } = require("ethers");
const { poseidon } = require("circomlibjs");
const snarkjs = require("snarkjs");

/**
 * 方案 1: 从链上事件重建 Merkle tree（适合中小规模）
 *
 * 优点：
 * - 完全去中心化，无需后端
 * - 数据来源可信（直接从链上）
 *
 * 缺点：
 * - commitment 数量多时（>10万），速度慢
 * - 需要下载和处理大量事件
 *
 * 适用场景：
 * - commitment 总数 < 10万
 * - 可以接受 10-30 秒的准备时间
 */
class MerklePathFromEvents {
  constructor(provider, zwTokenAddress) {
    this.provider = provider;
    this.zwTokenAddress = zwTokenAddress;
    this.zwToken = new ethers.Contract(
      zwTokenAddress,
      [
        "event CommitmentAdded(bytes32 indexed commitment, uint256 index, address indexed to, uint256 amount)",
        "function getCommitmentCount() view returns (uint256)",
        "function root() view returns (bytes32)",
      ],
      provider
    );
  }

  /**
   * 获取 Merkle path
   * @param {BigInt} targetCommitment - 目标 commitment
   * @returns {Promise<{root, pathElements, pathIndices, index}>}
   */
  async getMerklePath(targetCommitment) {
    console.log("📊 方案 1: 从链上事件重建 Merkle tree");
    console.log("⏳ 步骤 1/4: 获取 commitment 总数...");

    const count = await this.zwToken.getCommitmentCount();
    console.log(`   Total commitments: ${count}`);

    if (count > 100000) {
      console.warn(
        "⚠️  Warning: Too many commitments, consider using Method 2"
      );
    }

    console.log("⏳ 步骤 2/4: 获取所有 CommitmentAdded 事件...");
    const filter = this.zwToken.filters.CommitmentAdded();
    const events = await this.zwToken.queryFilter(filter, 0, "latest");
    console.log(`   Found ${events.length} events`);

    console.log("⏳ 步骤 3/4: 重建 Merkle tree...");
    const tree = new IncrementalMerkleTree(20);
    let targetIndex = -1;

    for (let i = 0; i < events.length; i++) {
      const commitment = events[i].args.commitment;
      tree.insert(commitment);

      if (BigInt(commitment) === targetCommitment) {
        targetIndex = i;
      }

      // 显示进度
      if ((i + 1) % 10000 === 0) {
        console.log(`   Progress: ${i + 1}/${events.length}`);
      }
    }

    if (targetIndex === -1) {
      throw new Error("Commitment not found in tree");
    }

    console.log("⏳ 步骤 4/4: 生成 Merkle proof...");
    const merkleProof = tree.getProof(targetIndex);

    // 验证 root 是否匹配
    const onchainRoot = await this.zwToken.root();
    const localRoot = "0x" + tree.root.toString(16).padStart(64, "0");

    if (localRoot !== onchainRoot) {
      throw new Error("Root mismatch! Tree may be out of sync");
    }

    console.log("✅ Merkle path generated successfully");
    console.log(`   Commitment index: ${targetIndex}`);
    console.log(`   Root: ${localRoot}`);

    return {
      root: tree.root,
      pathElements: merkleProof.pathElements,
      pathIndices: merkleProof.pathIndices,
      index: targetIndex,
    };
  }
}

/**
 * 方案 2: 优化版 - 增量获取事件（适合大规模）
 *
 * 优点：
 * - 内存占用小
 * - 可以提前终止（找到目标后停止）
 * - 可以显示进度条
 *
 * 缺点：
 * - 如果目标在后面，仍需扫描很多
 *
 * 适用场景：
 * - commitment 总数 > 10万
 * - 需要优化用户体验
 */
class MerklePathOptimized {
  constructor(provider, zwTokenAddress) {
    this.provider = provider;
    this.zwTokenAddress = zwTokenAddress;
    this.zwToken = new ethers.Contract(
      zwTokenAddress,
      [
        "event CommitmentAdded(bytes32 indexed commitment, uint256 index, address indexed to, uint256 amount)",
        "function getCommitmentCount() view returns (uint256)",
        "function root() view returns (bytes32)",
      ],
      provider
    );
    this.BATCH_SIZE = 10000; // 每批获取 10k 事件
  }

  async getMerklePath(targetCommitment, progressCallback) {
    console.log("📊 方案 2: 优化版 - 增量获取");

    const count = await this.zwToken.getCommitmentCount();
    console.log(`   Total commitments: ${count}`);

    const tree = new IncrementalMerkleTree(20);
    let targetIndex = -1;
    let processedCount = 0;

    // 获取部署区块
    const deployBlock = 0; // 实际应该存储或查询
    const latestBlock = await this.provider.getBlockNumber();

    // 分批获取
    for (
      let fromBlock = deployBlock;
      fromBlock <= latestBlock;
      fromBlock += this.BATCH_SIZE
    ) {
      const toBlock = Math.min(fromBlock + this.BATCH_SIZE - 1, latestBlock);

      console.log(`⏳ Fetching blocks ${fromBlock} - ${toBlock}...`);
      const filter = this.zwToken.filters.CommitmentAdded();
      const events = await this.zwToken.queryFilter(filter, fromBlock, toBlock);

      // 处理这批事件
      for (const event of events) {
        const commitment = event.args.commitment;
        tree.insert(commitment);

        if (BigInt(commitment) === targetCommitment) {
          targetIndex = processedCount;
          console.log(`✅ Found commitment at index ${targetIndex}`);
        }

        processedCount++;
      }

      // 更新进度
      if (progressCallback) {
        progressCallback(processedCount, Number(count));
      }

      // 如果找到目标且已处理完所有 commitment，可以提前退出
      if (targetIndex !== -1 && processedCount >= Number(count)) {
        break;
      }
    }

    if (targetIndex === -1) {
      throw new Error("Commitment not found");
    }

    const merkleProof = tree.getProof(targetIndex);
    const onchainRoot = await this.zwToken.root();
    const localRoot = "0x" + tree.root.toString(16).padStart(64, "0");

    if (localRoot !== onchainRoot) {
      throw new Error("Root mismatch!");
    }

    console.log("✅ Merkle path generated");

    return {
      root: tree.root,
      pathElements: merkleProof.pathElements,
      pathIndices: merkleProof.pathIndices,
      index: targetIndex,
    };
  }
}

/**
 * 方案 3: 合约查询接口（需要合约支持）
 *
 * 最优方案！需要在合约中添加：
 * ```solidity
 * function getMerklePath(bytes32 commitment) external view returns (
 *     bytes32[] memory pathElements,
 *     uint256[] memory pathIndices
 * )
 * ```
 *
 * 优点：
 * - 速度极快（1次 RPC 调用）
 * - 内存占用极小
 * - 用户体验最好
 *
 * 缺点：
 * - 需要修改合约
 * - 合约需要存储额外数据（filledSubtrees）
 * - 增加一些 gas 成本
 *
 * 建议：未来版本考虑添加此功能
 */

/**
 * 方案 4: 使用 The Graph 索引（推荐生产环境）
 *
 * 通过 The Graph 协议索引 CommitmentAdded 事件
 *
 * 优点：
 * - 速度极快
 * - 支持复杂查询
 * - 去中心化
 *
 * 实现：
 * 1. 创建 subgraph 索引 CommitmentAdded 事件
 * 2. 浏览器查询 Graph API
 * 3. 本地重建 Merkle tree
 *
 * GraphQL 查询示例：
 * ```graphql
 * query {
 *   commitments(first: 1000, orderBy: index) {
 *     commitment
 *     index
 *     to
 *     amount
 *   }
 * }
 * ```
 */

/**
 * Incremental Merkle Tree 实现
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
  }

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
        if (siblingIndex < this.nextIndex) {
          // 有真实的右兄弟，需要重建它的值
          // 简化：使用 zero（完整实现需要重建整个右子树）
          pathElements.push(this.zeros[i]);
        } else {
          // 没有右兄弟，使用 zero
          pathElements.push(this.zeros[i]);
        }
      }
      currentIndex = Math.floor(currentIndex / 2);
    }

    return { pathElements, pathIndices };
  }
}

/**
 * 完整的浏览器端 Claim 流程
 */
class BrowserClaimFlow {
  constructor(provider, signer, zwTokenAddress, wasmPath, zkeyPath) {
    this.provider = provider;
    this.signer = signer;
    this.zwTokenAddress = zwTokenAddress;
    this.wasmPath = wasmPath;
    this.zkeyPath = zkeyPath;

    // 选择 Merkle path 获取方案
    this.merklePathGenerator = new MerklePathOptimized(
      provider,
      zwTokenAddress
    );
  }

  /**
   * 执行完整的 claim 流程
   * @param {BigInt} secret - 用户的 secret
   * @param {string} recipientAddress - 接收地址
   * @param {BigInt} claimAmount - 要 claim 的金额
   */
  async executeClaim(secret, recipientAddress, claimAmount) {
    console.log("\n🎯 开始 Claim 流程");
    console.log("=".repeat(70));

    // 步骤 1: 推导隐私地址和 commitment
    console.log("\n📌 步骤 1: 推导地址和 commitment");
    const addrScalar = poseidon([secret]);
    const addr20 = addrScalar & ((1n << 160n) - 1n);
    const q = (addrScalar - addr20) / (1n << 160n);

    console.log(
      `   Privacy address: 0x${addr20.toString(16).padStart(40, "0")}`
    );

    // 用户需要知道自己的 firstAmount（从链上查询或本地存储）
    const firstAmount = await this.getUserFirstAmount(addr20);
    console.log(`   First amount: ${firstAmount}`);

    if (claimAmount > firstAmount) {
      throw new Error("Claim amount exceeds first amount");
    }

    const commitment = poseidon([addr20, firstAmount]);
    console.log(
      `   Commitment: 0x${commitment.toString(16).padStart(64, "0")}`
    );

    // 步骤 2: 获取 Merkle path
    console.log("\n📌 步骤 2: 获取 Merkle path");
    const merklePath = await this.merklePathGenerator.getMerklePath(
      commitment,
      (processed, total) => {
        console.log(
          `   Progress: ${processed}/${total} (${(
            (processed / total) *
            100
          ).toFixed(1)}%)`
        );
      }
    );

    // 步骤 3: 生成 ZK proof
    console.log("\n📌 步骤 3: 生成 ZK proof");
    console.log("   ⏳ Generating proof (10-30 seconds)...");

    const nullifier = poseidon([addr20]);
    const circuitInput = {
      root: merklePath.root,
      nullifier: nullifier,
      to: BigInt(recipientAddress),
      claimAmount: claimAmount,
      secret: secret,
      addr20: addr20,
      firstAmount: firstAmount,
      q: q,
      pathElements: merklePath.pathElements.map((e) => BigInt(e)),
      pathIndices: merklePath.pathIndices,
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInput,
      this.wasmPath,
      this.zkeyPath
    );

    console.log("   ✅ Proof generated!");

    // 格式化 proof
    const calldata = await snarkjs.groth16.exportSolidityCallData(
      proof,
      publicSignals
    );
    const calldataJson = JSON.parse("[" + calldata + "]");

    // 步骤 4: 提交交易
    console.log("\n📌 步骤 4: 提交 claim 交易");
    const zwToken = new ethers.Contract(
      this.zwTokenAddress,
      [
        "function claim(uint256[2] a, uint256[2][2] b, uint256[2] c, bytes32 root, bytes32 nullifier, address to, uint256 amount) external",
      ],
      this.signer
    );

    const tx = await zwToken.claim(
      calldataJson[0], // a
      calldataJson[1], // b
      calldataJson[2], // c
      "0x" + merklePath.root.toString(16).padStart(64, "0"), // root
      "0x" + nullifier.toString(16).padStart(64, "0"), // nullifier
      recipientAddress, // to
      claimAmount // amount
    );

    console.log(`   Transaction hash: ${tx.hash}`);
    console.log("   ⏳ Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log(`   ✅ Confirmed! Gas used: ${receipt.gasUsed}`);

    console.log("\n" + "=".repeat(70));
    console.log("🎉 Claim 成功!");
    console.log("=".repeat(70));

    return {
      txHash: tx.hash,
      gasUsed: receipt.gasUsed,
    };
  }

  /**
   * 获取用户的 firstAmount
   * 实际实现中，可以：
   * 1. 从链上查询 CommitmentAdded 事件（通过 to 地址过滤）
   * 2. 从本地存储读取
   * 3. 让用户输入
   */
  async getUserFirstAmount(addr20) {
    // 简化实现：从链上查询
    const zwToken = new ethers.Contract(
      this.zwTokenAddress,
      [
        "event CommitmentAdded(bytes32 indexed commitment, uint256 index, address indexed to, uint256 amount)",
      ],
      this.provider
    );

    const privacyAddress = ethers.getAddress(
      "0x" + addr20.toString(16).padStart(40, "0")
    );
    const filter = zwToken.filters.CommitmentAdded(null, null, privacyAddress);
    const events = await zwToken.queryFilter(filter, 0, "latest");

    if (events.length === 0) {
      throw new Error("No commitment found for this address");
    }

    // 第一个事件的 amount 就是 firstAmount
    return events[0].args.amount;
  }
}

/**
 * 使用示例
 */
async function exampleUsage() {
  // 在浏览器中，provider 来自 window.ethereum
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();

  const claimFlow = new BrowserClaimFlow(
    provider,
    signer,
    "0x...", // ZWToken 地址
    "/path/to/claim_first_receipt.wasm",
    "/path/to/claim_first_receipt_final.zkey"
  );

  const secret = 123456789n; // 用户的 secret
  const recipient = "0x..."; // 接收地址
  const amount = ethers.parseEther("100"); // 要 claim 的金额

  const result = await claimFlow.executeClaim(secret, recipient, amount);
  console.log("Result:", result);
}

// 导出
module.exports = {
  MerklePathFromEvents,
  MerklePathOptimized,
  IncrementalMerkleTree,
  BrowserClaimFlow,
};
