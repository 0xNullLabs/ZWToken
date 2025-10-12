# ZWToken - Browser-Friendly ZK Wrapper Token

> **隐私 Wrapper Token，浏览器生成 ZK 证明，无需后端**

[![Solidity](https://img.shields.io/badge/Solidity-^0.8.20-blue)](https://soliditylang.org/)
[![Circom](https://img.shields.io/badge/Circom-2.1.6-green)](https://docs.circom.io/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 🎯 核心特性

### ✨ 关键亮点

- **🌐 浏览器友好**：Proof 生成仅需 5-12 秒，12K 约束
- **🔒 完全隐私**：地址和金额私有，ZK 证明验证
- **💰 Gas 友好**：0.2 Gwei 时首次接收仅 $0.33
- **🚀 无后端依赖**：前端完全自主，仅需 RPC provider
- **📱 移动端支持**：中高端移动设备可用
- **🎨 简洁实现**：直接更新 commitment，无批量提交

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

### Gas 成本（0.2 Gwei）

| 操作                  | Gas      | USD ($2000/ETH) |
| --------------------- | -------- | --------------- |
| Deposit               | 65K      | $0.026          |
| 普通 Transfer         | 55K      | $0.022 ✅       |
| **首次接收 Transfer** | **820K** | **$0.328** ✅   |
| Claim                 | 320K     | $0.128          |

**关键**：95% 的转账保持标准 ERC20 成本！

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

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 编译电路

```bash
# 需要先下载 PTAU 文件（~2.1 GB）
wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_22.ptau

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
# 单元测试
npx hardhat test test/claim.test.js

# E2E 测试
npx hardhat test test/e2e.test.js
```

---

## 📖 使用指南

### 作为用户

#### 1. 获取 ZWToken

```javascript
const { ZWToken } = require("./artifacts/contracts/ZWToken.sol/ZWToken.json");

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
│   ├── claim_first_receipt.circom    # 主电路（12K 约束）
│   └── out/                        # 编译输出
├── contracts/
│   ├── ZWToken.sol                  # 主合约
│   └── Groth16Verifier.sol          # ZK 验证器
├── client/
│   └── merkle_proof_frontend.js       # 前端 Merkle proof 生成
├── test/
│   ├── claim.test.js               # 单元测试
│   └── e2e.test.js                 # E2E 测试
├── scripts/
│   ├── build_circuit.sh            # 电路编译脚本
│   └── deploy.js                   # 部署脚本
└── docs/
    ├── NEW_ARCHITECTURE_FINAL.md      # 详细架构文档
    └── BROWSER_PROOF_VERIFICATION.md  # 浏览器可行性验证
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

### 文档

- [详细架构文档](docs/NEW_ARCHITECTURE_FINAL.md)
- [浏览器可行性验证](docs/BROWSER_PROOF_VERIFICATION.md)
- [前端集成指南](docs/FRONTEND_INTEGRATION.md)

### 技术参考

- [Circom 文档](https://docs.circom.io/)
- [snarkjs 文档](https://github.com/iden3/snarkjs)
- [Poseidon Hash](https://www.poseidon-hash.info/)
- [Groth16](https://eprint.iacr.org/2016/260.pdf)

---

## 💬 联系方式

- Issues: [GitHub Issues](https://github.com/your-repo/issues)
- Discussions: [GitHub Discussions](https://github.com/your-repo/discussions)

---

<div align="center">
  
**🎉 让隐私ZK在浏览器中成为现实！**

Made with ❤️ using Circom, Solidity, and ethers.js

</div>
