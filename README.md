# ZWToken - Browser-Friendly ZK Wrapper Token

> **隐私 Wrapper Token，浏览器生成 ZK 证明，无需后端**

[![Solidity](https://img.shields.io/badge/Solidity-^0.8.20-blue)](https://soliditylang.org/)
[![Circom](https://img.shields.io/badge/Circom-2.1.6-green)](https://docs.circom.io/)
[![Tests](https://img.shields.io/badge/Tests-25%2F25-brightgreen)]()
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 🎉 项目状态

**版本**: 2.0.0 (2025-10-12)  
**测试状态**: ✅ 25/25 全部通过  
**生产就绪**: ✅ 可部署主网

---

## 🎯 核心特性

### ✨ 关键亮点

- **🌐 浏览器友好**：Proof 生成仅需 5-12 秒，12K 约束
- **🔒 完全隐私**：地址和金额私有，ZK 证明验证
- **💰 Gas 高效**：95% 转账保持标准 ERC20 成本
- **🚀 无后端依赖**：前端完全自主，仅需 RPC provider
- **📱 移动端支持**：中高端移动设备可用
- **🎨 架构清晰**：完整注释，易于理解和扩展
- **✅ 充分测试**：25 个测试全部通过，包含真实 ZK proof

---

## 📊 性能数据

### 电路性能

```
约束数：12,166（vs 传统方案的 3,000,000）
减少：99.6% ✅

浏览器 Proof 生成：
- 桌面：5-10 秒 ✅
- 移动：8-15 秒 ✅

内存需求：~250 MB
zKey 大小：~12 MB
```

### Gas 成本（0.2 Gwei，$4000/ETH）

| 操作                | Gas       | ETH           | USD        | vs USDT       |
| ------------------- | --------- | ------------- | ---------- | ------------- |
| **USDT Transfer**   | **35K**   | **0.0000070** | **$0.028** | **基准**      |
| Deposit (首次)      | 107K      | 0.0000214 ETH | $0.085     | +3.0x         |
| Deposit (后续)      | 55K       | 0.0000111 ETH | $0.044     | +1.6x         |
| **Transfer (首次)** | **1.07M** | **0.0002142** | **$0.857** | **+30.5x**    |
| **Transfer (后续)** | **38K**   | **0.0000075** | **$0.030** | **+1.07x ✅** |
| Claim (首次 + ZK)   | 764K      | 0.0001529 ETH | $0.611     | +21.8x        |
| Claim (后续)        | 75K       | 0.0000151 ETH | $0.060     | +2.1x         |
| Withdraw            | 51K       | 0.0000102 ETH | $0.041     | +1.5x         |

**关键发现**：

- ✅ **后续转账成本几乎与 USDT 相同**（仅多 7%，~38K vs ~35K gas）
- ✅ 首次接收的高 Gas 成本是**一次性的**（~$0.86），为该地址提供永久隐私
- ✅ 在 L2（如 Arbitrum、Optimism）上成本可降低 10-100 倍
- 📊 **详细 Gas 分析报告**：见 [GAS\_分析报告.md](./GAS_分析报告.md) 和 [GAS_PROFILE_REPORT.md](./GAS_PROFILE_REPORT.md)

---

## 🏗️ 架构设计

### 工作流程

```
1. Deposit → 获得 ZWToken (无 commitment)
2. Transfer → 如果接收者首次收到，自动生成 commitment
   ├─ 计算 commitment = Poseidon(address, amount)
   ├─ 插入 20 层 Merkle tree
   └─ Gas: 首次 ~820K，后续 ~55K
3. Claim → ZK 证明 + 提现
   ├─ 浏览器生成 proof (5-12 秒)
   ├─ 验证 commitment 在 Merkle tree 中
   └─ 转出 underlying token
```

### ZK 电路

```circom
// circuits/claim_first_receipt.circom
// 20 层 Poseidon Merkle tree

证明内容：
✅ 用户知道某个地址的 secret
✅ 该地址有首次接收记录（commitment 在树中）
✅ claimAmount <= firstAmount
✅ nullifier 防双花
```

---

## 📡 Subgraph 支持

ZWToken 现在支持 The Graph 协议，用于高效查询所有 `CommitmentAdded` 事件，让前端能够：

- 🔍 **快速查询**：无需扫描区块链，直接查询所有 commitments
- 🌲 **构建 Merkle Tree**：前端可自行构建完整的 Merkle tree 和 proof
- 📊 **实时同步**：自动跟踪新的 commitments 和 root 更新
- ⚡ **零 Gas 成本**：查询不消耗 gas

### Subgraph 快速入门

```bash
# 1. 准备 Subgraph
cd subgraph
npm install

# 2. 更新配置（替换为实际的合约地址和网络）
./scripts/update-config.sh sepolia 0x1234...5678 1234567

# 3. 生成代码
npm run codegen

# 4. 构建
npm run build

# 5. 部署到本地 Graph 节点
npm run create:local
npm run deploy:local
```

### 前端集成示例

```javascript
import { ApolloClient, InMemoryCache, gql } from "@apollo/client";
import { ethers } from "ethers";

// 1. 连接 Subgraph（查询历史事件）
const apolloClient = new ApolloClient({
  uri: "http://localhost:8000/subgraphs/name/zwtoken-subgraph",
  cache: new InMemoryCache(),
});

// 2. 连接合约（查询当前状态）
const provider = new ethers.JsonRpcProvider(RPC_URL);
const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

// 3. 查询所有 commitments（从 Subgraph）
const { data } = await apolloClient.query({
  query: gql`
    query {
      commitments(first: 1000, orderBy: index) {
        commitment
        index
      }
    }
  `,
});

// 4. 查询链上状态（从合约）
const currentRoot = await contract.root();
const count = await contract.getCommitmentCount();

// 5. 构建 Merkle tree 并验证
const tree = await buildMerkleTreeFromSubgraph(data.commitments);
console.assert(tree.root() === currentRoot, "Root 验证失败！");

// 6. 生成 proof
const proof = tree.generateProof(leafIndex);
```

详细文档和示例请参阅 [`subgraph/README.md`](subgraph/README.md)

---

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 编译电路

```bash
# 需要先下载 powersOfTau28_hez_final_15.ptau
wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_15.ptau

# 编译电路并生成 verifier
chmod +x scripts/build_circuit.sh
./scripts/build_circuit.sh
```

### 3. 部署合约

```bash
# 编译合约
npx hardhat compile

# 部署到本地测试网
npx hardhat run scripts/deploy.js --network localhost

# 或部署到主网/L2
npx hardhat run scripts/deploy.js --network mainnet
```

### 4. 运行测试

```bash
# 运行所有测试
npx hardhat test

# 运行特定测试
npx hardhat test test/commitment_v2.test.js    # 功能测试 (15/15)
npx hardhat test test/claim_v2_e2e.test.js     # E2E 测试 (3/3)
npx hardhat test test/e2e_v2.test.js           # 真实 ZK proof (1/1)

# 查看 Gas 报告
REPORT_GAS=true npx hardhat test
```

---

## 📖 使用指南

### 作为用户

#### 1. 获取 ZWToken

```javascript
const {
  ZWTokenV2,
} = require("./artifacts/contracts/ZWTokenV2.sol/ZWTokenV2.json");

// Deposit underlying token
await underlyingToken.approve(zwToken.address, amount);
await zwToken.deposit(amount);
```

#### 2. 转账到隐私地址

```javascript
const { poseidon } = require("circomlibjs");

// 生成隐私地址
const secret = randomBigInt(); // 用户保管
const addrScalar = poseidon([secret]);
const addr20 = addrScalar & ((1n << 160n) - 1n);
const privacyAddress = "0x" + addr20.toString(16).padStart(40, "0");

// 转账（首次接收会生成 commitment）
await zwToken.transfer(privacyAddress, amount);
```

#### 3. Claim（浏览器生成 Proof）

```javascript
const { ZKProofGenerator } = require("./client/merkle_proof_frontend");

// 初始化
const generator = new ZKProofGenerator(contractAddress, provider);

// 生成电路输入
const circuitInput = await generator.generateCircuitInput(
  secret, // 用户的秘密
  recipientAddress, // 接收地址
  claimAmount // 提现金额
);

// 生成 ZK proof（浏览器，5-12 秒）
const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  circuitInput,
  "claim_first_receipt.wasm",
  "claim_first_receipt_final.zkey"
);

// 提交 claim
await zwToken.claim(
  proof.pi_a,
  proof.pi_b,
  proof.pi_c,
  circuitInput.root,
  circuitInput.nullifier,
  recipientAddress,
  claimAmount
);
```

---

## 🛠️ 技术栈

### 智能合约

- Solidity ^0.8.20
- OpenZeppelin Contracts
- Poseidon-Solidity

### ZK 电路

- Circom 2.1.6
- circomlib
- snarkjs (Groth16)

### 前端

- ethers.js v6
- snarkjs (browser)
- circomlibjs
- 自实现 Incremental Merkle Tree

---

## 📂 项目结构

```
ZWToken/
├── circuits/
│   ├── claim_first_receipt.circom         # 主电路（12,166 约束）
│   └── out/                               # 编译输出
│       ├── claim_first_receipt.wasm       # 证明生成器
│       ├── claim_first_receipt_final.zkey # 验证密钥（12MB）
│       └── verification_key.json          # 公开参数
│
├── contracts/
│   ├── ZWTokenV2.sol                      # 主合约 ⭐
│   ├── Groth16Verifier.sol                # ZK 验证器
│   └── mocks/                             # 测试辅助合约
│       ├── MockVerifier.sol               # Mock ZK 验证器
│       └── ERC20Mock.sol                  # Mock ERC20 代币
│
├── client/
│   ├── merkle_proof_frontend.js           # Merkle proof 生成工具
│   ├── browser_claim_example.js           # 浏览器完整示例
│   └── generate_proof.js                  # Proof 生成工具
│
├── test/
│   ├── commitment_v2.test.js              # 功能测试 (15/15)
│   ├── claim_v2_e2e.test.js               # E2E 测试 (3/3)
│   ├── e2e_v2.test.js                     # 真实 ZK proof E2E (1/1)
│   └── (其他测试)                         # Gas 对比等 (6/6)
│
├── scripts/
│   └── build_circuit.sh                   # 电路编译脚本（含 PTAU 优化）
│
└── docs/
    ├── NEW_ARCHITECTURE_FINAL.md          # 详细架构文档
    ├── BROWSER_PROOF_VERIFICATION.md      # 浏览器可行性验证
    ├── BROWSER_MERKLE_PATH.md             # Merkle path 方案
    ├── PROJECT_OVERVIEW.md                # 项目概览
    ├── REFACTOR_COMPLETE_V2.md            # 重构报告
    └── TEST_SUMMARY_V2.md                 # 测试总结
```

---

## 🔒 安全考虑

### 隐私保护

- ✅ 地址和金额是私有输入，不上链
- ✅ Secret 永远不离开用户设备
- ✅ Commitment 是 Poseidon hash，无法反推
- ✅ ZK 证明确保无信息泄露

### 防攻击

- ✅ Nullifier 防双花（每个地址只能 claim 一次）
- ✅ Root 历史支持（防 front-running）
- ✅ 金额范围验证（claimAmount <= firstAmount）
- ✅ ZK proof 强制诚实性

### 已知限制

- ⚠️ 只记录首次接收（后续接收不生成新 commitment）
- ⚠️ 用户必须保管 secret（丢失无法恢复）
- ⚠️ 首次接收 Gas 较高（~820K）

---

## 📈 对比分析

### vs 原方案（Keccak256）

| 维度         | 原方案    | (Poseidon)  | 改善           |
| ------------ | --------- | ----------- | -------------- |
| 电路约束     | 3,000,000 | **12,166**  | **-99.6%** ✅  |
| Proof 时间   | 5-15 分钟 | **5-12 秒** | **50-150x** ✅ |
| 浏览器       | ❌ 不可行 | ✅ **完美** | 从不可用到完美 |
| 首次接收 Gas | ~235K     | ~820K       | +248% ⚠️       |

**结论**：用 3.5 倍 Gas 换取 99.6% 约束减少和浏览器可用性 - **值得！**

### vs 批量提交方案

| 维度         | 批量提交 | 直接更新（) | 优势 |
| ------------ | -------- | ----------- | ---- |
| 实现复杂度   | 高       | **低**      |      |
| 用户体验     | 需等待   | **即时**    |      |
| 首次接收 Gas | ~95K     | ~820K       | 批量 |
| 协议成本     | 需激励者 | **无**      |      |

**结论**：在 0.2 Gwei 下，用户愿意支付 $0.33 换取简单和即时 - **选择直接更新**

---

## 🎯 适用场景

### ✅ 适合

- 隐私转账应用
- 空投/奖励分发（记录首次接收）
- L2 部署（Gas 更低）
- 需要浏览器生成 proof 的 dApp
- C 端用户应用

### ⚠️ 不太适合

- 需要多次 claim 同一地址的场景
- Gas price 极高的网络（如主网高峰期）
- 需要合并多笔接收的场景

---

## 🤝 贡献

欢迎贡献！请查看 [CONTRIBUTING.md](CONTRIBUTING.md)

---

## 📄 许可

MIT License - 详见 [LICENSE](LICENSE)

---

## 📚 相关资源

### 项目文档

#### 快速开始

- [项目概览](PROJECT_OVERVIEW.md) - 完整的项目介绍和快速开始指南
- [测试总结](TEST_SUMMARY_V2.md) - 25/25 测试通过报告
- [更新日志](CHANGELOG.md) - 版本更新记录

#### 架构与设计

- [详细架构文档](docs/NEW_ARCHITECTURE_FINAL.md) - 完整的系统架构说明
- [浏览器可行性验证](docs/BROWSER_PROOF_VERIFICATION.md) - 浏览器端实现验证
- [Merkle Path 方案](docs/BROWSER_MERKLE_PATH.md) - 前端 Merkle proof 生成
- [重构报告](REFACTOR_COMPLETE_V2.md) - 重构细节和设计决策

#### 技术指南

- [真实 ZK Proof 指南](REAL_ZK_PROOF_GUIDE.md) - 生成真实证明的详细步骤
- [PTAU 文件指南](PTAU_SIZE_GUIDE.md) - Powers of Tau 文件选择和优化
- [项目状态](FINAL_PROJECT_STATUS.md) - 完整项目状态报告

### 技术参考

- [Circom 文档](https://docs.circom.io/) - 零知识电路语言
- [snarkjs 文档](https://github.com/iden3/snarkjs) - ZK proof 生成工具
- [Poseidon Hash](https://www.poseidon-hash.info/) - ZK 友好哈希函数
- [Groth16 论文](https://eprint.iacr.org/2016/260.pdf) - ZK proof 系统

---

## 💬 联系方式

- Issues: [GitHub Issues](https://github.com/your-repo/issues)
- Discussions: [GitHub Discussions](https://github.com/your-repo/discussions)

---

<div align="center">

---

## 🎉 项目成就

**电路约束减少 99.6%** (3M → 12K)  
**Proof 生成加速 50-150x** (5-15 分钟 → 5-12 秒)  
**完整测试覆盖** (25/25 测试通过，含真实 ZK proof)  
**架构清晰** (完整注释，易于理解和扩展)

---

**🎉 让隐私 ZK 在浏览器中成为现实！**

Made with ❤️ using Circom, Solidity, and ethers.js

**最后更新**: 2025-10-12  
**License**: MIT

</div>

---

## 📝 更新历史

### 2.0.0 (2025-10-12)

- ✅ 正式发布生产就绪版本
- ✅ 完整的代码注释和文档
- ✅ 25 个测试全部通过（含真实 ZK proof）
- ✅ 架构清晰，易于理解和扩展
- ✅ 完善的项目文档体系
- ✅ Gas 成本透明化说明

### 1.0.0-beta (2025-10)

- ✅ 完成电路设计（12,166 约束）
- ✅ 实现 Poseidon Merkle tree
- ✅ 浏览器 proof 生成验证（5-12 秒）
- ✅ 完整文档编写
- ✅ 基础测试覆盖
