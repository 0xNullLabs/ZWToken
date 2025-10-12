# 浏览器端获取 Merkle Path 方案

## 🎯 问题描述

在真实场景中，用户需要在浏览器中生成 ZK proof 来 claim ZWToken。生成 proof 需要 Merkle path（20 层的 `pathElements` 和 `pathIndices`）。

**核心挑战**：如何在浏览器中高效获取 Merkle path？

---

## 📊 方案对比

| 方案                   | 速度    | 内存 | 去中心化    | 实现难度 | 推荐场景             |
| ---------------------- | ------- | ---- | ----------- | -------- | -------------------- |
| **方案 1: 事件重建**   | 慢      | 高   | ✅ 完全     | 简单     | <10 万 commitments   |
| **方案 2: 增量获取**   | 中      | 低   | ✅ 完全     | 中等     | 任意规模             |
| **方案 3: 合约查询**   | ⚡ 极快 | 极低 | ✅ 完全     | 需改合约 | **推荐**（新项目）   |
| **方案 4: The Graph**  | ⚡ 极快 | 低   | ✅ 去中心化 | 中等     | **推荐**（现有项目） |
| **方案 5: 中心化 API** | 快      | 极低 | ❌ 中心化   | 简单     | 不推荐               |

---

## 🔍 方案详解

### 方案 1: 从链上事件重建 Merkle Tree

**原理**：

1. 获取所有 `CommitmentAdded` 事件
2. 在浏览器中重建完整 Merkle tree
3. 查找用户的 commitment 位置
4. 生成 Merkle proof

**代码**：

```javascript
class MerklePathFromEvents {
  async getMerklePath(targetCommitment) {
    // 1. 获取所有事件
    const filter = zwToken.filters.CommitmentAdded();
    const events = await zwToken.queryFilter(filter, 0, "latest");

    // 2. 重建树
    const tree = new IncrementalMerkleTree(20);
    let targetIndex = -1;

    for (let i = 0; i < events.length; i++) {
      tree.insert(events[i].args.commitment);
      if (events[i].args.commitment === targetCommitment) {
        targetIndex = i;
      }
    }

    // 3. 生成 proof
    return tree.getProof(targetIndex);
  }
}
```

**性能分析**：

| Commitments | 事件获取 | 树重建 | 总时间 | 内存    |
| ----------- | -------- | ------ | ------ | ------- |
| 1,000       | ~1s      | ~0.1s  | ~1s    | ~1 MB   |
| 10,000      | ~3s      | ~1s    | ~4s    | ~10 MB  |
| 100,000     | ~15s     | ~10s   | ~25s   | ~100 MB |
| 1,000,000   | ~150s    | ~100s  | ~250s  | ~1 GB   |

**优点**：

- ✅ 完全去中心化
- ✅ 无需后端
- ✅ 实现简单

**缺点**：

- ❌ commitment 数量多时很慢
- ❌ 内存占用高
- ❌ 用户体验差（等待时间长）

**适用场景**：

- Commitment 总数 < 10 万
- 对速度要求不高
- MVP 或测试阶段

---

### 方案 2: 优化版 - 增量获取

**改进**：

1. 分批获取事件（每批 5k-10k）
2. 边获取边构建树
3. 显示进度条
4. 找到目标后可提前终止

**代码**：

```javascript
class MerklePathOptimized {
  async getMerklePath(targetCommitment, progressCallback) {
    const BATCH_SIZE = 10000;
    const tree = new IncrementalMerkleTree(20);
    let processedCount = 0;

    for (let fromBlock = 0; fromBlock <= latestBlock; fromBlock += BATCH_SIZE) {
      const toBlock = Math.min(fromBlock + BATCH_SIZE - 1, latestBlock);
      const events = await zwToken.queryFilter(filter, fromBlock, toBlock);

      for (const event of events) {
        tree.insert(event.args.commitment);
        processedCount++;
        progressCallback(processedCount, totalCount);
      }
    }

    return tree.getProof(targetIndex);
  }
}
```

**性能分析**：

| Commitments | 优化后时间 | 内存    | 用户体验 |
| ----------- | ---------- | ------- | -------- |
| 100,000     | ~20s       | ~50 MB  | 有进度条 |
| 1,000,000   | ~180s      | ~100 MB | 有进度条 |

**优点**：

- ✅ 内存占用更低
- ✅ 可显示进度
- ✅ 可提前终止
- ✅ 完全去中心化

**缺点**：

- ❌ 仍然较慢（大规模时）

**适用场景**：

- 任意规模的 commitment
- 需要良好用户体验
- 当前推荐方案（无需改合约）

---

### 方案 3: 合约查询接口 ⭐

**原理**：在合约中添加查询函数，直接返回 Merkle path

**需要修改合约**：

```solidity
contract ZWToken {
    // 存储 filledSubtrees（用于快速查询）
    mapping(uint256 => bytes32) public filledSubtrees;

    /**
     * @notice 获取 commitment 的 Merkle path
     * @param commitment 目标 commitment
     * @return pathElements Merkle path elements
     * @return pathIndices Path indices
     */
    function getMerklePath(bytes32 commitment)
        external
        view
        returns (
            bytes32[] memory pathElements,
            uint256[] memory pathIndices
        )
    {
        // 1. 查找 commitment 的 index
        uint256 index = commitmentToIndex[commitment];
        require(index < nextIndex, "Commitment not found");

        pathElements = new bytes32[](TREE_DEPTH);
        pathIndices = new uint256[](TREE_DEPTH);

        uint256 currentIndex = index;

        // 2. 构建 path
        for (uint256 i = 0; i < TREE_DEPTH; i++) {
            if (currentIndex % 2 == 0) {
                // 左子节点
                pathIndices[i] = 0;
                pathElements[i] = zeros[i];
            } else {
                // 右子节点
                pathIndices[i] = 1;
                pathElements[i] = filledSubtrees[i];
            }
            currentIndex /= 2;
        }

        return (pathElements, pathIndices);
    }
}
```

**浏览器端调用**：

```javascript
// 1 次 RPC 调用即可获取 Merkle path！
const [pathElements, pathIndices] = await zwToken.getMerklePath(commitment);
```

**性能分析**：

| 操作      | 时间    | Gas       | 用户体验   |
| --------- | ------- | --------- | ---------- |
| 获取 path | **<1s** | 0（view） | ⭐⭐⭐⭐⭐ |

**优点**：

- ✅ 速度极快（<1 秒）
- ✅ 内存占用极小
- ✅ 用户体验最佳
- ✅ 完全去中心化

**缺点**：

- ❌ 需要修改合约
- ❌ 需要存储 `filledSubtrees`（增加少量 gas）

**Gas 成本影响**：

- 存储 `filledSubtrees[i]`：每次插入增加 ~5k-20k gas
- 对于 20 层树：每次插入额外 ~100k-200k gas

**适用场景**：

- 新项目
- 可以接受稍高的插入 gas
- 追求最佳用户体验

**建议**：下一版本添加此功能！

---

### 方案 4: The Graph 索引 ⭐

**原理**：使用 The Graph 协议索引链上事件，提供 GraphQL API

**实现步骤**：

1. **创建 Subgraph**：

```yaml
# subgraph.yaml
specVersion: 0.0.4
schema:
  file: ./schema.graphql
dataSources:
  - kind: ethereum/contract
    name: ZWToken
    network: mainnet
    source:
      address: "0x..."
      abi: ZWToken
      startBlock: 12345678
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.6
      language: wasm/assemblyscript
      entities:
        - Commitment
      eventHandlers:
        - event: CommitmentAdded(indexed bytes32,uint256,indexed address,uint256)
          handler: handleCommitmentAdded
      file: ./src/mapping.ts
```

2. **定义 Schema**：

```graphql
# schema.graphql
type Commitment @entity {
  id: ID!
  commitment: Bytes!
  index: BigInt!
  to: Bytes!
  amount: BigInt!
  blockNumber: BigInt!
  timestamp: BigInt!
}
```

3. **浏览器端查询**：

```javascript
const query = `
  query GetCommitments {
    commitments(
      first: 1000000, 
      orderBy: index, 
      orderDirection: asc
    ) {
      commitment
      index
    }
  }
`;

const response = await fetch(GRAPH_API_URL, {
  method: "POST",
  body: JSON.stringify({ query }),
});

const { data } = await response.json();

// 重建 Merkle tree
const tree = new IncrementalMerkleTree(20);
for (const item of data.commitments) {
  tree.insert(item.commitment);
}
```

**性能分析**：

| Commitments | 查询时间 | 树重建 | 总时间 |
| ----------- | -------- | ------ | ------ |
| 100,000     | ~2s      | ~10s   | ~12s   |
| 1,000,000   | ~5s      | ~100s  | ~105s  |

**优点**：

- ✅ 查询速度快
- ✅ 支持复杂查询
- ✅ 去中心化（The Graph 网络）
- ✅ 无需修改合约

**缺点**：

- ❌ 需要部署 subgraph
- ❌ 有一定延迟（通常 <1 分钟）
- ❌ 仍需重建树

**适用场景**：

- 生产环境
- 大规模应用
- 需要复杂查询

---

### 方案 5: 中心化 API（不推荐）

**原理**：运行后端服务，维护 Merkle tree，提供 API

```
Backend:
- 监听 CommitmentAdded 事件
- 维护完整 Merkle tree
- 提供 REST API: GET /merkle-path/:commitment

Frontend:
- 调用 API 获取 path
- 生成 ZK proof
- 提交交易
```

**优点**：

- ✅ 速度极快
- ✅ 前端实现简单

**缺点**：

- ❌ 中心化（单点故障）
- ❌ 需要运维
- ❌ 用户需要信任后端
- ❌ 违背去中心化原则

**不推荐原因**：失去隐私和去中心化优势！

---

## 🎯 推荐方案

### 当前项目（短期）

**使用方案 2：增量获取**

```javascript
const generator = new MerklePathOptimized(provider, zwTokenAddress);
const merklePath = await generator.getMerklePath(
  commitment,
  (processed, total) => {
    updateProgressBar(processed / total);
  }
);
```

**理由**：

- 无需修改合约
- 性能可接受
- 完全去中心化
- 有进度反馈

### 下一版本（长期）

**方案 3 + 方案 4 组合**：

1. **合约添加 `getMerklePath`**（方案 3）

   - 提供最快的查询速度
   - 用户体验最佳

2. **同时部署 The Graph**（方案 4）
   - 作为备用方案
   - 支持历史数据查询
   - 支持复杂分析

**实现**：

```javascript
class HybridMerklePathGenerator {
  async getMerklePath(commitment) {
    try {
      // 优先使用合约查询（最快）
      return await this.getFromContract(commitment);
    } catch (error) {
      // 降级到 The Graph
      return await this.getFromGraph(commitment);
    }
  }
}
```

---

## 📊 用户体验对比

### 场景：100 万 commitments

| 方案   | 准备时间       | 用户感受    | 评分       |
| ------ | -------------- | ----------- | ---------- |
| 方案 1 | ~250s          | 😤 太慢了   | ⭐         |
| 方案 2 | ~180s + 进度条 | 😐 能接受   | ⭐⭐⭐     |
| 方案 3 | <1s            | 😍 太快了！ | ⭐⭐⭐⭐⭐ |
| 方案 4 | ~105s          | 🙂 还不错   | ⭐⭐⭐⭐   |

---

## 🛠️ 实现建议

### 现在（当前项目）

1. 实现方案 2（`browser_claim_example.js` 已提供）
2. 添加友好的 UI
   - 进度条
   - 预计剩余时间
   - 可取消操作

### 未来（v3）

1. 合约添加 `getMerklePath` 函数
2. 部署 The Graph subgraph
3. 前端支持多种方案降级

---

## 💡 最佳实践

### 缓存策略

用户可以缓存以下数据（IndexedDB）：

```javascript
// 缓存树结构（不常变化）
const cache = {
  lastUpdate: Date.now(),
  commitmentCount: 1000000,
  treeRoot: "0x...",
  myCommitments: [
    { commitment: "0x...", index: 12345, amount: "500" }
  ]
};

// 增量更新
if (onchainCount > cache.commitmentCount) {
  // 只获取新的 commitments
  const newEvents = await queryFilter(
    fromBlock: lastUpdateBlock,
    toBlock: "latest"
  );
}
```

### 预加载优化

```javascript
// 用户打开页面时，后台开始重建树
async function preloadMerkleTree() {
  const generator = new MerklePathOptimized(provider, zwTokenAddress);
  await generator.rebuildTree(); // 后台执行
}

// 用户点击 Claim 时，树已经准备好
async function onClaimClick() {
  const merklePath = generator.getProofFromCache(commitment);
  // 立即生成 proof，无需等待
}
```

---

## 🎯 总结

| 阶段     | 推荐方案   | 理由      |
| -------- | ---------- | --------- |
| **MVP**  | 方案 1     | 简单快速  |
| **Beta** | 方案 2     | 性能 + UX |
| **生产** | 方案 3 + 4 | 最佳体验  |

**关键要点**：

1. ✅ 始终保持去中心化
2. ✅ 提供进度反馈
3. ✅ 支持多种方案降级
4. ✅ 缓存优化用户体验

**下一步行动**：

1. 使用方案 2 完成当前项目
2. 规划 v3 添加合约查询接口
3. 考虑部署 The Graph（生产环境）
