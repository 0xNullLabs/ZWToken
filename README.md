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
- 📊 **详细 Gas 分析报告**：见 [GAS\_分析报告.md](./GAS_分析报告.md)

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
// circuits/remint.circom
// 20 层 Poseidon Merkle tree

证明内容：
✅ 用户知道某个地址的 secret
✅ 该地址有首次接收记录（commitment 在树中）
✅ remintAmount <= commitAmount
✅ nullifier 防双花
```

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
npx hardhat test test/commitment.test.js       # Commitment 功能测试
npx hardhat test test/e2e.test.js              # E2E 测试
npx hardhat test test/remint.test.js           # Remint 功能测试
npx hardhat test test/gas-profile.test.js      # Gas 分析测试

# 查看 Gas 报告
REPORT_GAS=true npx hardhat test
```

---

## 📖 使用指南

### 作为用户

#### 1. 获取 ZWToken

```javascript
const {
  ZWERC20,
} = require("./artifacts/contracts/ZWERC20.sol/ZWERC20.json");

// Deposit underlying token
await underlyingToken.approve(zwToken.address, amount);
await zwToken.deposit(recipientAddress, 0, amount); // (to, id, amount)
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

#### 3. Remint（浏览器生成 Proof）

```javascript
const snarkjs = require("snarkjs");

// 生成 ZK proof（浏览器，5-12 秒）
const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  circuitInput,
  "remint.wasm",
  "remint_final.zkey"
);

// 格式化 proof
const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);

// 提交 remint
await zwToken.remint(
  recipientAddress,     // to
  0,                    // id (0 for ERC-20)
  remintAmount,         // amount
  false,                // withdrawUnderlying
  {                     // RemintData struct
    commitment: root,
    nullifiers: [nullifier],
    proverData: "0x",
    relayerData: "0x",
    proof: proofBytes
  }
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
│   ├── remint.circom                      # 主电路（约 12K 约束）
│   └── out/                               # 编译输出
│       ├── remint.wasm                    # 证明生成器
│       ├── remint_final.zkey              # 验证密钥（~12MB）
│       └── verification_key.json          # 公开参数
│
├── contracts/
│   ├── ZWERC20.sol                        # 主合约 ⭐
│   ├── Groth16Verifier.sol                # ZK 验证器（由 snarkjs 生成）
│   ├── interfaces/                        # 接口定义
│   │   ├── IERC8065.sol                   # ERC-8065 接口
│   │   └── ISnarkVerifier.sol             # ZK 验证器接口
│   ├── utils/
│   │   └── PoseidonMerkleTree.sol         # Poseidon Merkle Tree 实现
│   └── mocks/                             # 测试辅助合约
│       ├── MockVerifier.sol               # Mock ZK 验证器
│       └── ERC20Mock.sol                  # Mock ERC20 代币
│
├── utils/
│   └── merkle-tree-utils.js               # Merkle Tree JS 工具
│
├── test/
│   ├── commitment.test.js                 # Commitment 功能测试
│   ├── e2e.test.js                        # E2E 测试
│   ├── remint.test.js                     # Remint 功能测试
│   └── gas-profile.test.js                # Gas 分析测试
│
├── scripts/
│   ├── build_circuit.sh                   # 电路编译脚本
│   └── deploy.js                          # 部署脚本
│
├── website/                               # 前端 Web 应用
│
└── deployments/                           # 部署记录
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

欢迎提交 Issue 和 Pull Request！

---

## 📄 许可

MIT License - 详见 [LICENSE](LICENSE)

---

## 📚 相关资源

### 项目文档

- [项目结构](PROJECT_STRUCTURE.md) - 项目目录结构说明
- [合约文档](contracts/README.md) - 智能合约详解
- [Gas 分析报告](GAS_分析报告.md) - Gas 成本分析
- [部署指南](DEPLOYMENT_GUIDE.md) - 部署流程说明

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

---

## 📦 部署记录

### Sepolia - 2025/11/6 15:53:20

**合约地址:**

- PoseidonT3: [`0xABCEffcB2b5fD8958A9358eC6c218F91b7bA0A62`](https://sepolia.etherscan.io/address/0xABCEffcB2b5fD8958A9358eC6c218F91b7bA0A62)
- Verifier: [`0xaB165da0aB5D12C0D75ff49b53319fff60140C51`](https://sepolia.etherscan.io/address/0xaB165da0aB5D12C0D75ff49b53319fff60140C51)
- ZWERC20: [`0xFdb64908218B900585571218a77a0a1B47c537e7`](https://sepolia.etherscan.io/address/0xFdb64908218B900585571218a77a0a1B47c537e7)
- Underlying Token (USDC): [`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`](https://sepolia.etherscan.io/address/0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238)

**代币信息:**

- 名称: Zero Knowledge Wrapper USDC
- 符号: ZWUSDC
- 小数位数: 6

**费用配置:**

- 费用收集器: `0xb54cCfa7eDFcF0236D109fe9e7535D3c7b761cCb`
- 费用分母: 1000000
- 存款费率: 0 (0.00%)
- Remint 费率: 0 (0.00%)
- 提款费率: 0 (0.00%)

**部署账户:** `0xb54cCfa7eDFcF0236D109fe9e7535D3c7b761cCb`
