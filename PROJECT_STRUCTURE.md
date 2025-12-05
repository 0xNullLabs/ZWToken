# ZWToken 项目结构

ZK Wrapper Token - 基于零知识证明的隐私代币包装器

## 📁 项目目录结构

```
ZWToken/
├── contracts/                      # Solidity 智能合约
│   ├── ZWERC20.sol                # 主合约（实现 IERC8065）
│   ├── Groth16Verifier.sol        # ZK proof 验证器（由 snarkjs 生成）
│   ├── interfaces/                # 接口定义
│   │   ├── IERC8065.sol           # ERC-8065 接口
│   │   └── ISnarkVerifier.sol     # Verifier 接口
│   ├── utils/                     # 工具合约
│   │   └── PoseidonMerkleTree.sol # Poseidon Merkle Tree 实现
│   ├── mocks/                     # Mock 合约（仅用于测试）
│   │   ├── ERC20Mock.sol          # Mock ERC20 代币
│   │   └── MockVerifier.sol       # Mock ZK 验证器
│   └── README.md                  # 合约文档
│
├── circuits/                       # ZK 电路
│   ├── remint.circom              # 主电路（约 12K 约束）
│   └── out/                       # 编译输出
│       ├── remint_js/             # JS witness 生成器
│       ├── remint.wasm            # WASM witness 生成器
│       ├── remint_final.zkey      # Proving key
│       └── verification_key.json  # Verification key
│
├── utils/                          # 通用工具
│   └── merkle-tree-utils.js       # Merkle Tree JS 实现
│
├── test/                           # 测试文件
│   ├── e2e.test.js                # 端到端测试
│   ├── commitment.test.js         # Commitment 记录测试
│   ├── remint.test.js             # Remint 功能测试
│   └── gas-profile.test.js        # Gas 分析测试
│
├── scripts/                        # 脚本工具
│   ├── build_circuit.sh           # 电路编译脚本
│   └── deploy.js                  # 部署脚本
│
├── website/                        # 前端 Web 应用
│
├── deployments/                    # 部署记录
├── artifacts/                      # Hardhat 编译产物
├── cache/                          # Hardhat 缓存
├── node_modules/                   # 依赖包
├── hardhat.config.js              # Hardhat 配置
├── package.json                   # 项目依赖
└── README.md                      # 项目主文档
```

## 🎯 核心模块说明

### 1. 智能合约层 (`contracts/`)

**主合约**:

- `ZWERC20.sol`: 核心业务逻辑
  - Deposit/Withdraw: 包装/解包装代币
  - Transfer: 标准 ERC20 转账 + commitment 记录
  - Claim: ZK proof 验证的隐私转账

**工具合约** (`utils/`):

- `PoseidonMerkleTree.sol`: Poseidon 哈希 Merkle Tree
  - 增量式更新
  - 历史 root 支持
  - Gas 优化设计

**接口** (`interfaces/`):

- `ISnarkVerifier.sol`: ZK proof 验证器标准接口

### 2. ZK 电路层 (`circuits/`)

**电路实现**:

- `remint.circom`:
  - 验证 secret → privacy address 推导
  - 验证 commitment 在 Merkle tree 中
  - 验证 remint 金额 ≤ commit amount
  - 约 12K 约束（5-12 秒生成 proof）

**编译产物** (`out/`):

- `remint.wasm`: WASM 见证生成器
- `remint_final.zkey`: Proving key
- `verification_key.json`: Verification key

### 3. 工具层 (`utils/`)

**共享 JS 工具**:

- `merkle-tree-utils.js`:
  - `IncrementalMerkleTree`: 简化版（测试/浏览器）
  - `PoseidonMerkleTree`: 完整版（合约存储客户端）
  - 被 2 个模块共用（test, client）

### 4. 前端 Web 应用 (`website/`)

**功能**:

- 浏览器端 ZK proof 生成
- 与合约交互（deposit, transfer, remint, withdraw）
- 钱包连接

### 5. 测试层 (`test/`)

**测试套件**:

- `e2e.test.js`: 端到端测试
- `commitment.test.js`: Commitment 记录逻辑
- `remint.test.js`: Remint 功能测试
- `gas-profile.test.js`: Gas 分析测试

## 🔧 技术栈

### 智能合约

- **Solidity**: ^0.8.20
- **Hardhat**: 开发环境
- **OpenZeppelin**: ERC20 标准实现
- **poseidon-solidity**: ZK 友好哈希函数

### ZK 证明

- **Circom**: 电路语言
- **snarkjs**: Proof 生成/验证
- **Groth16**: 证明系统（~200 bytes proof）

### 前端工具

- **ethers.js**: 以太坊交互
- **circomlibjs**: Poseidon 哈希 JS 实现

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 编译合约

```bash
npx hardhat compile
```

### 3. 编译电路

```bash
./scripts/build_circuit.sh
```

### 4. 运行测试

```bash
npx hardhat test                    # 所有测试
npx hardhat test test/e2e.test.js  # E2E 测试
```

## 📊 数据流

### Deposit → Transfer → Remint 流程

```
1. Alice deposits 1000 underlying tokens
   ↓
   ZWERC20.deposit(to, 0, amount) → mint ZWT to recipient

2. Alice transfers 500 ZWT to privacy address
   ↓
   transfer() → _update() → _recordCommitmentIfNeeded()
   ↓
   commitment = Poseidon(addr20, 500)
   ↓
   _insertLeaf() → 更新 Merkle tree
   ↓
   store commitment in leafs array

3. 用户生成 ZK proof
   ↓
   从合约存储查询 commitments
   ↓
   本地重建 Merkle tree + 生成 proof
   ↓
   构造 circuit inputs

4. 用户提交 remint
   ↓
   ZWERC20.remint(to, id, amount, withdrawUnderlying, data)
   ↓
   验证 root in isKnownRoot
   ↓
   验证 nullifier not used
   ↓
   verifier.verifyProof() → true
   ↓
   mint ZWT to recipient (or withdraw underlying)
   ↓
   _recordCommitmentIfNeeded() (if minting)
```

## 🔐 隐私保护

1. **Burn Address**: 从 secret 推导（不关联真实身份）
2. **Commitment**: Poseidon(addr20, firstAmount) 记录在链上
3. **Nullifier**: 防止重复 claim，但不泄露 commitment
4. **ZK Proof**: 证明拥有 secret，但不透露 secret 本身

## 📚 文档索引

- [主 README](./README.md): 项目概述
- [合约文档](./contracts/README.md): 智能合约详解

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License
