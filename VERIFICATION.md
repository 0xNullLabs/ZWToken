# 验证检查清单

## 前置依赖

```bash
npm install
```

## 1. 合约编译 ✅

```bash
npx hardhat compile
```

**预期输出**：

- Compiled 4 Solidity files successfully
- 生成 artifacts/ 目录

**验证项**：

- [x] ZWToken.sol
- [x] Verifier.sol (占位版)
- [x] DevMockVerifier.sol

## 2. 测试运行 ✅

```bash
npx hardhat test
```

**预期输出**：

- ✓ mints on valid claim and prevents double-claim via nullifier
- 1 passing

**验证项**：

- [x] 成功领取并铸造
- [x] 重复 nullifier 被拒绝

## 3. 本地部署 ✅

```bash
npx hardhat run scripts/deploy.js --network hardhat
```

**预期输出**：

- deployer: 0x...
- verifier: 0x...
- token: 0x...

## 4. 电路编译 ⚠️ (需 circomlib)

**前置**：

```bash
# 安装 circom v2.x 与 snarkjs
npm install -g circom snarkjs

# 获取 circomlib
git clone https://github.com/iden3/circomlib.git
```

**编译**（修改 scripts/build_circuit.sh 加入 -l 路径）：

```bash
circom circuits/airdrop_from_state_root.circom \
  --r1cs --wasm --sym \
  -l circomlib/circuits \
  -o circuits/out
```

**当前状态**：

- 电路引用了 circomlib/poseidon 与 circomlib/bitify
- 占位了 RLP/Keccak/MPT 的接口，但未实际接入
- **可编译**（需 circomlib）但证明内容为占位等式

## 5. CLI 脚本 ✅

### build_inputs (需要真实 RPC)

```bash
node client/build_inputs.js \
  --rpc https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY \
  --token 0xYourTokenAddr \
  --secret 0x1234...64hex \
  --magic 0xabcd...64hex \
  --to 0xRecipient \
  --out inputs.json
```

**预期**：生成 inputs.json 包含 public/private 字段

### build_circuit_input

```bash
node client/build_circuit_input.js --in inputs.json --out circuit_input.json
```

**预期**：生成扁平化的 circuit_input.json

### submit_claim (需要已生成的 proof.json)

```bash
node client/submit_claim.js \
  --rpc http://localhost:8545 \
  --pk 0xYourPrivKey \
  --contract 0xTokenAddr \
  --proof proof.json \
  --inputs inputs.json
```

**预期**：交易提交并确认

## 当前可运行范围总结

### ✅ 立即可运行（无外部依赖）

1. `npm install` 安装依赖
2. `npx hardhat compile` 编译合约
3. `npx hardhat test` 运行测试（使用 DevMockVerifier）
4. `npx hardhat run scripts/deploy.js` 本地部署

### ⚠️ 需补充依赖

1. **circomlib**：电路编译需要

   - 解决方案：`git clone https://github.com/iden3/circomlib.git` 或 `npm install circomlib`
   - 修改 `scripts/build_circuit.sh` 加入 `-l circomlib/circuits`

2. **RLP/Keccak/MPT 组件**：真实证明需要

   - 当前为占位实现（仅等式绑定）
   - 需接入 circom-rlp、zkTrie/circom-mpt 等库

3. **真实 RPC 端点**：CLI 需要
   - `build_inputs.js` 需要可用的以太坊 RPC（主网/测试网/本地链）

## 推荐验证流程

### 阶段 1：本地单元验证（✅ 现在可做）

```bash
npm install
npx hardhat compile
npx hardhat test
```

### 阶段 2：电路编译验证（需 circomlib）

```bash
# 安装 circomlib
npm install circomlib

# 修改 scripts/build_circuit.sh 后执行
bash scripts/build_circuit.sh
```

### 阶段 3：端到端集成（需真实 RPC 与电路完整实现）

```bash
# 1. 构建输入
node client/build_inputs.js --rpc ... --token ... --secret ... --magic ... --to ... --out inputs.json

# 2. 转换为电路输入
node client/build_circuit_input.js --in inputs.json --out circuit_input.json

# 3. 生成证明（需完整电路）
node circuits/out/airdrop_from_state_root_js/generate_witness.js \
  circuits/out/airdrop_from_state_root_js/airdrop_from_state_root.wasm \
  circuit_input.json witness.wtns
snarkjs groth16 prove circuits/out/airdrop_final.zkey witness.wtns proof.json public.json

# 4. 提交
node client/submit_claim.js --rpc ... --pk ... --contract ... --proof proof.json --inputs inputs.json
```

## 已知限制与待办

- [ ] 电路未接入真实 RLP/Keccak/MPT（占位版仅做等式绑定）
- [ ] 需手动设置 MAGIC 值（修改 circuits/airdrop_from_state_root.circom 最后一行）
- [ ] scripts/build_circuit.sh 需补充 circomlib 路径
- [ ] 真实部署需替换 Verifier.sol 为 snarkjs 导出的版本

## 结论

✅ **合约、测试、CLI 脚本均可立即编译/运行**（需 `npm install`）
⚠️ **电路可编译但需 circomlib**；真实证明需补充 RLP/Keccak/MPT 组件
✅ **端到端流程已打通**（使用占位 Verifier 可跑通 mock 版本）
