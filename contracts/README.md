# ZWToken Contracts Structure

本目录包含 ZWToken 的所有智能合约。合约已按功能模块化拆分，便于维护和测试。

## 📁 文件结构

```
contracts/
├── ZWToken.sol                    # 主合约：ZK Wrapper Token
├── Groth16Verifier.sol           # ZK proof 验证器（由 snarkjs 生成）
├── interfaces/                    # 接口定义
│   └── ISnarkVerifier.sol        # ZK proof 验证器接口
├── utils/                         # 工具合约
│   └── PoseidonMerkleTree.sol    # Poseidon Merkle Tree 实现
└── mocks/                         # 测试辅助合约
    ├── ERC20Mock.sol             # Mock ERC20 代币
    └── MockVerifier.sol          # Mock ZK 验证器
```

## 📄 合约说明

### 主合约

#### `ZWToken.sol`

ZK Wrapper Token 主合约，提供以下功能：

- **Deposit/Withdraw**: 包装/解包装底层 ERC20 代币
- **Transfer**: 支持标准 ERC20 转账，自动记录首次接收 commitment
- **Claim**: 使用 ZK proof 进行隐私转账
- **First Receipt Tracking**: 记录每个地址首次接收代币的金额

继承关系：

- `ERC20` (OpenZeppelin)
- `PoseidonMerkleTree` (自定义工具合约)

### 接口

#### `interfaces/ISnarkVerifier.sol`

Groth16 ZK-SNARK 验证器的标准接口。

**方法**:

- `verifyProof()`: 验证 ZK proof 的有效性

**实现**:

- `Groth16Verifier.sol`: 由 snarkjs 从电路自动生成

### 工具合约

#### `utils/PoseidonMerkleTree.sol`

增量式 Poseidon Merkle Tree 的抽象实现。

**特性**:

- ✅ 增量更新（无需重建整棵树）
- ✅ ZK 友好（使用 Poseidon 哈希）
- ✅ Gas 优化（只存储填充的子树）
- ✅ 支持历史 root 验证

**核心功能**:

- `_insertLeaf()`: 插入新叶子节点
- `_poseidonHash()`: 计算 Poseidon 哈希
- `isKnownRoot[]`: 验证历史 root 是否有效

**状态变量**:

- `root`: 当前 Merkle root
- `nextIndex`: 下一个插入位置
- `zeros[]`: 各层的零值哈希
- `filledSubtrees[]`: 各层最右侧已填充节点

## 🔧 依赖库

### 外部库

1. **OpenZeppelin Contracts** (v5.x)

   - `ERC20`: 标准 ERC20 实现
   - `IERC20`: ERC20 接口
   - `SafeERC20`: 安全的 ERC20 调用

2. **poseidon-solidity**
   - `PoseidonT3`: Poseidon 哈希函数（2 个输入）

### 安装依赖

```bash
npm install @openzeppelin/contracts poseidon-solidity
```

## 🎯 合约交互流程

### 1. Deposit 流程

```
User → deposit(amount) → ZWToken (mint)
     ↓
Underlying Token 转入合约
```

### 2. 首次接收跟踪

```
transfer/claim → _recordCommitmentIfNeeded()
                 ↓
                 hasFirstReceiptRecorded[to] = true
                 ↓
                 commitment = Poseidon(address, firstAmount)
                 ↓
                 _insertLeaf(commitment) → 更新 Merkle Tree
```

### 3. Claim 流程（隐私转账）

```
User → claim(proof, root, nullifier, to, amount)
     ↓
验证 root 是否为历史有效 root
     ↓
验证 nullifier 未被使用
     ↓
验证 ZK proof (via ISnarkVerifier)
     ↓
Mint ZWToken 到 to 地址
     ↓
记录 commitment（如果是首次接收）
```

## 🔐 安全特性

1. **防重放攻击**: 使用 `nullifierUsed` 映射
2. **历史 root 支持**: 允许使用旧的 Merkle root（支持并发 claim）
3. **ZK proof 验证**: 所有 claim 必须提供有效的零知识证明
4. **首次接收不可变**: 一旦记录，无法修改

## 📊 Gas 优化

- **增量 Merkle Tree**: 只更新必要的节点，避免重建整棵树
- **Sparse Tree**: 不存储所有节点，只存储 `filledSubtrees`
- **历史 root**: 使用 mapping 而非数组，节省 gas

## 🧪 测试

合约测试位于 `test/` 目录：

- `e2e.test.js`: 端到端测试（含真实 ZK proof）
- `commitment.test.js`: Commitment 记录测试
- `claim.test.js`: Claim 功能测试

运行测试：

```bash
npx hardhat test
```

## 📚 更多信息

- 电路代码: `circuits/claim_first_receipt.circom`
- 前端示例: `client/browser_claim_example.js`
- Subgraph: `subgraph/`
