# 🚀 快速启动指南

## ✅ 已完成的工作

1. ✅ npm 依赖已安装
2. ✅ Solidity 合约已编译（15 个文件）
3. ✅ Circom 电路已编译（Groth16 证明系统）
4. ✅ Verifier.sol 已生成并导出
5. ✅ 所有测试文件已更新为使用 ZWToken

---

## 🧪 运行测试

### 方案 1：Mock 测试（最快，推荐开发阶段）

```bash
# 运行 mock 测试（无需 eth_getProof）
npx hardhat test test/claim-mock.test.js

# 运行基本 claim 测试
npx hardhat test test/claim.test.js

# 运行所有本地测试（会跳过 e2e）
npx hardhat test test/claim*.js
```

**结果示例：**

```
✔ 完整流程：deposit → mock 证明 → claim（无需 eth_getProof）
✔ mints on valid claim and prevents double-claim via nullifier

2 passing
```

---

### 方案 2：使用 Anvil 运行完整测试（支持 eth_getProof）

#### 步骤 1：安装 Foundry/Anvil

```bash
# 如果还没有安装
curl -L https://foundry.paradigm.xyz | bash
foundryup

# 验证安装
anvil --version
```

#### 步骤 2：使用自动化脚本

```bash
# 一键运行（推荐）
./scripts/test-with-anvil.sh
```

#### 步骤 3：或手动运行

```bash
# 终端 1：启动 Anvil
anvil --port 8545

# 终端 2：运行完整测试
npx hardhat test test/e2e.test.js --network localhost
```

---

### 方案 3：Hardhat Fork 模式

```bash
# 设置环境变量（可选）
export MAINNET_RPC_URL="https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY"

# 运行 fork 测试
npx hardhat test --network hardhat-fork
```

---

## 📊 测试命令对比

| 命令                                       | eth_getProof | 速度      | 用途            |
| ------------------------------------------ | ------------ | --------- | --------------- |
| `npx hardhat test test/claim-mock.test.js` | ❌           | ⚡️⚡️⚡️ | 快速验证逻辑    |
| `./scripts/test-with-anvil.sh`             | ✅           | ⚡️⚡️    | 完整功能测试    |
| `npx hardhat test --network localhost`     | ✅           | ⚡️⚡️    | 手动 Anvil 测试 |
| `npx hardhat test --network hardhat-fork`  | ✅           | ⚡️       | Fork 主网测试   |

---

## 🔍 调试命令

```bash
# 仅运行特定测试
npx hardhat test test/claim-mock.test.js --grep "完整流程"

# 查看详细日志
npx hardhat test test/claim-mock.test.js --verbose

# 编译合约
npx hardhat compile

# 清理并重新编译
npx hardhat clean && npx hardhat compile

# 检查合约大小
npx hardhat size-contracts
```

---

## 📁 项目结构

```
zk-claim-poc/
├── contracts/
│   ├── ZWToken.sol          # 主合约（ERC20 + ZK claim）
│   ├── Verifier.sol           # Groth16 验证器（自动生成）
│   ├── DevMockVerifier.sol    # Mock 验证器（测试用）
│   └── MockERC20.sol          # 测试用 ERC20
├── circuits/
│   ├── claim_from_state_root.circom  # 电路定义
│   └── out/
│       ├── claim_final.zkey         # 证明密钥
│       ├── verification_key.json      # 验证密钥
│       └── claim_from_state_root_js/ # WASM 生成器
├── test/
│   ├── claim.test.js          # 基本 claim 测试
│   ├── claim-mock.test.js     # Mock 完整流程测试 ✅
│   └── e2e.test.js            # 需要 eth_getProof 的完整测试
├── scripts/
│   ├── build_circuit.sh       # 编译电路脚本
│   ├── test-with-anvil.sh     # Anvil 测试脚本 ✅
│   └── deploy*.js             # 部署脚本
├── TEST_GUIDE.md              # 详细测试指南 ✅
└── QUICK_START.md             # 本文件 ✅
```

---

## 🎯 下一步工作

### 对于开发测试：

```bash
# 1. 运行 mock 测试确认逻辑正确
npx hardhat test test/claim-mock.test.js

# 2. 根据需要修改合约或测试
# 3. 快速验证
npx hardhat compile && npx hardhat test test/claim-mock.test.js
```

### 对于完整验证：

```bash
# 1. 安装 Anvil
curl -L https://foundry.paradigm.xyz | bash && foundryup

# 2. 运行完整测试
./scripts/test-with-anvil.sh

# 3. 查看 eth_getProof 工作正常
```

### 对于电路开发：

```bash
# 1. 修改电路文件
vim circuits/claim_from_state_root.circom

# 2. 重新编译电路
./scripts/build_circuit.sh

# 3. 重新编译合约（包含新的 Verifier.sol）
npx hardhat compile

# 4. 运行测试
npx hardhat test
```

---

## ⚠️ 常见问题

### Q: 测试失败说 "Method eth_getProof is not supported"

A: 这是正常的，Hardhat 默认不支持。使用以下任一方案：

- **方案 1**：运行 mock 测试 `npx hardhat test test/claim-mock.test.js`
- **方案 2**：使用 Anvil `./scripts/test-with-anvil.sh`

### Q: Anvil 启动失败

A: 检查端口占用：

```bash
lsof -i :8545  # 查看 8545 端口
kill <PID>     # 关闭占用进程
```

### Q: 需要真实的 MPT 验证吗？

A: 目前的 mock 测试跳过了 MPT 验证。完整的 MPT 验证需要：

1. 完善 Circom 电路（接入 RLP/Keccak/MPT 组件）
2. 使用真实的 Verifier.sol
3. 生成真实的 Groth16 证明

---

## 📚 更多信息

- **详细测试指南**：查看 `TEST_GUIDE.md`
- **项目说明**：查看 `README.md`
- **验证文档**：查看 `VERIFICATION.md`
- **电路说明**：查看 `circuits/README.md`

---

## 💡 提示

- **开发时**：使用 mock 测试快速迭代
- **集成时**：使用 Anvil 验证完整流程
- **部署前**：在测试网上完整测试
- **生产环境**：使用真实的 Verifier 和证明

祝编码愉快！🎉
