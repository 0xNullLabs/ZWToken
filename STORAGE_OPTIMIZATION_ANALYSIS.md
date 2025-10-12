# 链上存储优化分析

**日期**: 2025-10-12  
**问题**: ⚠️ **无限增长的数组导致的 Gas 和存储问题**

---

## 🚨 当前问题

### 1. `commitments` 数组 (Line 45)

```solidity
bytes32[] public commitments;  // ⚠️ 无限增长！
```

**问题**:

- 每次有用户首次收款，数组增长一个元素
- 假设 1M 用户 = 1M 个 commitment = 32MB 链上存储
- `push` 操作的 gas 成本随数组增长而增加
- 潜在的区块 gas 限制问题

**当前用途**:

- `_insertLeaf()` 中 push commitment
- `getCommitmentCount()` 返回长度
- **实际上不需要存储整个数组！**

---

### 2. `rootHistory` 数组 (Line 53)

```solidity
bytes32[] public rootHistory;  // ⚠️ 无限增长！
mapping(bytes32 => bool) public isKnownRoot;
```

**问题**:

- 虽然有逻辑删除 `isKnownRoot[oldestRoot]`，但数组本身从不缩减
- 每次更新 root 都 push，永远增长
- `getRecentRoots()` 需要遍历数组

**当前逻辑**:

```solidity
if (rootHistory.length > ROOT_HISTORY_SIZE) {
    bytes32 oldestRoot = rootHistory[rootHistory.length - ROOT_HISTORY_SIZE - 1];
    delete isKnownRoot[oldestRoot];  // 只删除 mapping，不删除数组元素
}
```

---

## ✅ 优化方案

### 方案 1: 移除 `commitments` 数组 ⭐ (推荐)

**原理**:

- 用户通过监听 `CommitmentAdded` 事件来重建 Merkle tree
- 合约只需要存储：
  - `root`: 当前 Merkle root
  - `nextIndex`: commitment 计数
  - `filledSubtrees`: Merkle tree 缓存

**修改**:

```solidity
// ❌ 删除
// bytes32[] public commitments;

// ✅ 保留
bytes32 public root;
uint256 public nextIndex;
bytes32[TREE_DEPTH] public filledSubtrees;
```

**影响**:

- `getCommitmentCount()` 改为返回 `nextIndex`
- 删除任何遍历 `commitments` 的代码
- 前端通过事件重建（已在 `client/browser_claim_example.js` 实现）

**Gas 节省**: 每次首次收款节省 ~20K gas

---

### 方案 2: 优化 `rootHistory` - 环形缓冲区

**原理**:

- 使用固定大小的数组 + 环形索引
- 只保留最近 N 个 root

**修改**:

```solidity
uint256 public constant ROOT_HISTORY_SIZE = 100;
bytes32[ROOT_HISTORY_SIZE] public rootHistory;  // 固定大小
uint256 public rootHistoryIndex;  // 当前写入位置
mapping(bytes32 => bool) public isKnownRoot;

function _updateRoot(bytes32 newRoot) private {
    bytes32 oldRoot = root;
    root = newRoot;

    // 如果缓冲区已满，移除最老的 root
    if (rootHistoryIndex >= ROOT_HISTORY_SIZE) {
        bytes32 toRemove = rootHistory[rootHistoryIndex % ROOT_HISTORY_SIZE];
        delete isKnownRoot[toRemove];
    }

    // 写入新 root（环形）
    rootHistory[rootHistoryIndex % ROOT_HISTORY_SIZE] = newRoot;
    isKnownRoot[newRoot] = true;
    rootHistoryIndex++;

    emit RootUpdated(oldRoot, newRoot);
}
```

**优点**:

- 固定存储大小
- O(1) 写入和查询
- 防止无限增长

**缺点**:

- 只能保留最近 100 个 root
- 用户需要在 100 次 root 更新内完成 claim

---

### 方案 3: 只用 Mapping (最简单)

**原理**:

- 完全移除 `rootHistory` 数组
- 只用 `isKnownRoot` mapping
- 使用 LRU 或时间窗口淘汰旧 root

**修改**:

```solidity
// ❌ 删除
// bytes32[] public rootHistory;

// ✅ 保留
mapping(bytes32 => uint256) public rootTimestamp;  // root -> 添加时间
mapping(bytes32 => bool) public isKnownRoot;

uint256 public constant ROOT_VALIDITY_PERIOD = 7 days;

function claim(..., bytes32 root_) external {
    // 检查 root 是否有效
    if (!isKnownRoot[root_]) revert InvalidRoot();

    // 可选：检查 root 是否过期
    if (block.timestamp - rootTimestamp[root_] > ROOT_VALIDITY_PERIOD) {
        revert InvalidRoot();
    }

    // ... 验证 proof
}

function _updateRoot(bytes32 newRoot) private {
    root = newRoot;
    isKnownRoot[newRoot] = true;
    rootTimestamp[newRoot] = block.timestamp;

    emit RootUpdated(root, newRoot);
}
```

**优点**:

- 最小化链上存储
- 灵活的过期策略
- 无需遍历数组

**缺点**:

- 无法获取历史 root 列表（但实际上不需要）
- 需要定期清理旧 root（可以懒惰删除）

---

## 📊 Gas 对比

| 操作                | 当前设计 | 方案 1 (无数组) | 节省 |
| ------------------- | -------- | --------------- | ---- |
| 首次收款 (Transfer) | ~130K    | ~110K           | ~20K |
| 重复收款 (Transfer) | ~50K     | ~50K            | 0    |
| Claim               | ~1M      | ~1M             | 0    |

---

## 🎯 推荐方案

**组合使用方案 1 + 方案 2**:

1. ✅ **移除 `commitments` 数组**

   - 前端通过事件重建 Merkle tree
   - 节省 ~20K gas/次
   - 防止状态膨胀

2. ✅ **使用环形缓冲区管理 `rootHistory`**
   - 固定存储大小 (100 roots)
   - 防止无限增长
   - 保持足够的窗口期

---

## 📝 实施步骤

### 第 1 步: 移除 `commitments` 数组

```diff
- bytes32[] public commitments;
  uint256 public nextIndex;

  function _insertLeaf(bytes32 leaf) private {
-     commitments.push(leaf);
      commitmentToIndex[leaf] = nextIndex;
      nextIndex++;
  }

  function getCommitmentCount() external view returns (uint256) {
-     return commitments.length;
+     return nextIndex;
  }
```

### 第 2 步: 优化 `rootHistory`

```diff
- bytes32[] public rootHistory;
+ bytes32[ROOT_HISTORY_SIZE] public rootHistory;
+ uint256 public rootHistoryIndex;

  function _updateRoot(bytes32 newRoot) private {
+     if (rootHistoryIndex >= ROOT_HISTORY_SIZE) {
+         bytes32 toRemove = rootHistory[rootHistoryIndex % ROOT_HISTORY_SIZE];
+         delete isKnownRoot[toRemove];
+     }

-     rootHistory.push(newRoot);
+     rootHistory[rootHistoryIndex % ROOT_HISTORY_SIZE] = newRoot;
      isKnownRoot[newRoot] = true;
+     rootHistoryIndex++;
  }
```

### 第 3 步: 更新测试

- 更新 `getCommitmentCount()` 的测试
- 测试环形缓冲区边界情况
- 验证旧 root 过期逻辑

---

## ⚠️ 迁移注意事项

如果合约已部署：

1. 需要新版本合约
2. 用户需要迁移到新合约
3. 无法直接升级（不可升级合约）

如果尚未部署：
✅ **立即应用优化！**

---

**结论**: 当前设计有严重的可扩展性问题，必须在生产部署前修复。
