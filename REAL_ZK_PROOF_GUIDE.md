# 真实 ZK Proof 测试指南

**版本**:.1 Final  
**更新日期**: 2025-10-12

---

## 🎯 概述

`e2e.test.js` 是专门用于测试**真实 ZK proof 生成和验证**的 E2E 测试。

**关键特性**：

- ✅ 使用真实的 Groth16 verifier（不使用 Mock）
- ✅ 可选使用真实的 ZK proof（如果电路已编译）
- ✅ 完整模拟前端流程（Merkle tree 重建）
- ✅ 9 个阶段的完整验证

---

## 📋 前置要求

### 1. 必须先编译电路

**e2e.test.js 要求**：

- ✅ 必须有 `Groth16Verifier` 合约（通过电路编译生成）
- ⚠️ 如果没有编译电路，测试会直接报错并给出提示

### 2. 可选的真实 ZK proof

**完全真实的 E2E 测试需要**：

- ✅ `circuits/out/claim_first_receipt.wasm`
- ✅ `circuits/out/claim_first_receipt_final.zkey`

**如果这些文件不存在**：

- 测试会使用模拟的 proof 参数
- Verifier 仍然是真实的，只是 proof 是模拟的

---

## 🚀 编译电路步骤

### 步骤 1: 下载 PTAU 文件

```bash
# PTAU 文件（2.1 GB，一次性下载）
wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_22.ptau
```

**说明**：

- 这是 Hermez 的公开 Powers of Tau 文件
- 支持最多 2^28 约束（我们的电路只需 ~12K）
- 下载一次即可，后续无需重复

### 步骤 2: 赋予执行权限

```bash
chmod +x scripts/build_circuit.sh
```

### 步骤 3: 运行编译脚本

```bash
./scripts/build_circuit.sh
```

**编译过程**（约 2-5 分钟）：

```
1. 编译 Circom 电路 → claim_first_receipt.r1cs
2. 生成 witness 生成器 → claim_first_receipt.wasm
3. Groth16 setup → claim_first_receipt_0000.zkey
4. 贡献随机性 → claim_first_receipt_final.zkey
5. 导出验证密钥 → verification_key.json
6. 生成 Solidity verifier → Groth16Verifier.sol
```

### 步骤 4: 编译合约

```bash
npx hardhat compile
```

**现在应该有**：

- ✅ `contracts/Groth16Verifier.sol`
- ✅ `circuits/out/claim_first_receipt.wasm`
- ✅ `circuits/out/claim_first_receipt_final.zkey`

---

## 🧪 运行测试

### 运行 E2E 测试（真实 ZK）

```bash
npx hardhat test test/e2e.test.js
```

**预期输出**：

```
🚀 部署合约
✅ PoseidonT3: 0x...
✅ Underlying: 0x...
✅ Groth16Verifier: 0x...
✅ ZWToken: 0x...
📋 Verifier Type: Real Groth16 ✨

📝 E2E Test: Real ZK Proof
...
📌 阶段 6: 生成真实 ZK proof
   WASM file: ✅ .../claim_first_receipt.wasm
   zKey file: ✅ .../claim_first_receipt_final.zkey
   ⏳ Generating real ZK proof (this may take 10-30 seconds)...
   ✅ Real ZK proof generated!
...
🎉 E2E Test with REAL ZK Proof: PASSED!

📊 Summary:
   ZK Proof type: Real Groth16 ✨
```

### 如果没有编译电路

**错误提示**：

```
❌ Groth16Verifier not found!
📋 Please compile the circuit first:
   1. Download PTAU: wget https://...
   2. Run: chmod +x scripts/build_circuit.sh
   3. Run: ./scripts/build_circuit.sh
   4. Run tests again

Error: Groth16Verifier contract not found. Please compile circuit first.
```

---

## 📊 测试场景对比

### 各测试套件的定位

| 测试文件                   | Verifier | ZK Proof | 用途     |
| -------------------------- | -------- | -------- | -------- |
| **commitment.test.js**  | Mock     | -        | 功能测试 |
| **gas_comparison.test.js** | Mock     | -        | Gas 分析 |
| **claim_e2e.test.js**   | Mock     | Mock     | 快速 E2E |
| **e2e.test.js**         | **Real** | **Real** | 完整 E2E |

### commitment.test.js

**目的**：测试 commitment 记录逻辑  
**特点**：

- ✅ 使用 MockVerifier（快速）
- ✅ 15 个功能测试
- ✅ 验证核心逻辑

### gas_comparison.test.js

**目的**：分析 Gas 成本  
**特点**：

- ✅ 使用 MockVerifier（快速）
- ✅ 6 个性能测试
- ✅ 实测 Gas 数据

### claim_e2e.test.js

**目的**：快速 E2E 测试  
**特点**：

- ✅ 使用 MockVerifier（快速）
- ✅ 3 个 E2E 场景
- ✅ 无需编译电路

### e2e.test.js ⭐

**目的**：完整真实 E2E 测试  
**特点**：

- ✅ **必须使用 Real Groth16Verifier**
- ✅ 可选真实 ZK proof（如果电路已编译）
- ✅ 完整 9 阶段验证
- ✅ **唯一真正验证 ZK 系统的测试**

---

## 🎯 测试策略

### 开发阶段

```bash
# 快速迭代（使用 Mock）
npx hardhat test test/commitment.test.js
npx hardhat test test/claim_e2e.test.js
```

### 集成测试

```bash
# 包括 Gas 分析
npx hardhat test test/commitment.test.js \
                 test/gas_comparison.test.js \
                 test/claim_e2e.test.js
```

### 完整验证

```bash
# 1. 编译电路（一次性）
./scripts/build_circuit.sh

# 2. 运行所有测试
npx hardhat test

# 或只运行 E2E
npx hardhat test test/e2e.test.js
```

---

## 📈 性能预期

### 编译电路（一次性）

| 步骤          | 时间          | 输出         |
| ------------- | ------------- | ------------ |
| Circom 编译   | ~10s          | .r1cs, .wasm |
| Groth16 setup | ~60s          | .zkey        |
| 贡献随机性    | ~30s          | final.zkey   |
| 生成 verifier | ~5s           | .sol         |
| **总计**      | **~2-5 分钟** | -            |

### 测试执行

| 测试           | Verifier | Proof    | 时间        |
| -------------- | -------- | -------- | ----------- |
| commitment  | Mock     | -        | ~1s         |
| gas_comparison | Mock     | -        | ~1s         |
| claim_e2e   | Mock     | Mock     | ~1s         |
| **e2e**     | **Real** | **Real** | **~15-40s** |

**e2e 时间分解**：

- 部署合约：~1s
- 执行交易：~1s
- **生成 ZK proof：~10-30s**（主要时间）
- 验证：~1s

---

## 🔧 故障排查

### 问题 1: Groth16Verifier not found

**错误**：

```
❌ Groth16Verifier not found!
```

**解决**：

```bash
./scripts/build_circuit.sh
npx hardhat compile
```

### 问题 2: WASM/zKey 文件不存在

**现象**：

```
WASM file: ❌
zKey file: ❌
ℹ️  Using mock proof (testing only)
```

**影响**：

- Verifier 是真实的 ✅
- 但 proof 是模拟的 ⚠️

**解决**（如果想要完全真实的测试）：

```bash
./scripts/build_circuit.sh
```

### 问题 3: ZK proof 生成失败

**错误**：

```
⚠️  Failed to generate real proof: ...
ℹ️  Falling back to mock proof
```

**可能原因**：

1. 电路输入不正确
2. wasm/zKey 文件损坏
3. 内存不足

**解决**：

1. 检查电路输入格式
2. 重新编译电路
3. 增加可用内存

### 问题 4: 编译超时

**问题**：编译电路时间过长

**解决**：

- 正常现象，Groth16 setup 需要 1-2 分钟
- 可以检查 CPU 使用率
- 只需编译一次

---

## 📝 最佳实践

### 1. 首次使用

```bash
# 一次性设置（~5 分钟）
wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_22.ptau
chmod +x scripts/build_circuit.sh
./scripts/build_circuit.sh
npx hardhat compile

# 运行完整测试
npx hardhat test
```

### 2. 日常开发

```bash
# 快速迭代（使用 Mock verifier 的测试）
npx hardhat test test/commitment.test.js
npx hardhat test test/claim_e2e.test.js

# 偶尔运行完整验证
npx hardhat test test/e2e.test.js
```

### 3. CI/CD

**选项 A：跳过真实 ZK proof**

```yaml
# 只运行 Mock verifier 测试
- run: npx hardhat test test/commitment.test.js
- run: npx hardhat test test/claim_e2e.test.js
```

**选项 B：完整测试（缓存 PTAU）**

```yaml
# 缓存 PTAU 文件
- uses: actions/cache@v3
  with:
    path: powersOfTau28_hez_final_22.ptau
    key: ptau-22

# 编译并测试
- run: ./scripts/build_circuit.sh
- run: npx hardhat test
```

---

## 🎉 总结

### e2e.test.js 的特点

- ✅ **唯一使用真实 Groth16 verifier 的测试**
- ✅ 完整验证 ZK 系统的正确性
- ✅ 可选真实 ZK proof（如果电路已编译）
- ✅ 提供清晰的错误提示

### 为什么移除 MockVerifier

**原因**：

1. **明确测试目的**：e2e.test.js 就是为了测试真实 ZK
2. **避免误导**：使用 Mock 会让人误以为测试通过了真实 ZK 验证
3. **清晰的错误提示**：如果没准备好，应该明确告诉用户

**其他测试仍使用 Mock**：

- commitment.test.js ✅
- gas_comparison.test.js ✅
- claim_e2e.test.js ✅

这样既保证了快速迭代，又有完整的真实验证！

---

**编译状态**：需要手动运行 `./scripts/build_circuit.sh`  
**测试要求**：必须有 Groth16Verifier  
**推荐使用**：CI 中使用快速测试，发布前运行完整 E2E
