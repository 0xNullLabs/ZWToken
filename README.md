# ZWToken - Zero Knowledge Wrapper Token

> **ZWToken is an [ERC-8065](https://ethereum-magicians.org/t/erc-8065-zero-knowledge-token-wrapper/26006/1) implementation that brings native privacy to all tokens through browser-based ZK proof generation, requiring no backend other than an Ethereum node.**

[![Solidity](https://img.shields.io/badge/Solidity-^0.8.20-blue)](https://soliditylang.org/)
[![Circom](https://img.shields.io/badge/Circom-2.1.6-green)](https://docs.circom.io/)
[![Tests](https://img.shields.io/badge/Tests-40%2F40-brightgreen)]()
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 🎉 Project Status

**Version**: 2.0.0 (2025-12-05)  
**Test Status**: ✅ 40/40 All Passing  
**Production Ready**: ✅ Ready for Mainnet Deployment

---

## 🎯 Core Features

### ✨ Key Highlights

- **🌐 Browser Friendly**: Proof generation 875ms desktop, ~3s mobile (13,084 constraints)
- **🔒 Full Privacy**: Address and amount private, ZK proof verification
- **💰 Gas Efficient**: Subsequent transfers only 7% more than standard ERC20
- **🚀 No Backend Required**: Frontend fully autonomous, only needs RPC provider
- **📱 Mobile Compatible**: ✅ Works on all modern mobile browsers
- **🎨 Clean Architecture**: Complete documentation, easy to understand
- **✅ Thoroughly Tested**: All tests passing, including real ZK proofs

---

## 📊 Performance Data

### Circuit Performance

> 📊 数据来源: `zk-profile.json` (生成于 2025-12-05)

```
Constraints: 13,084 (实测值，来自 snarkjs r1cs info)
Circuit Files: 7.69 MB total (remint.wasm 2.14MB + zkey 5.55MB)

Browser Proof Generation (实测，5次平均):
- Desktop: 875ms ✅
- Mobile (mid-range): ~3.1s ✅

Memory Usage: 6.13 MB total (浏览器友好)
```

### Gas Cost (0.2 Gwei, $4000/ETH)

> 📊 数据来源: `gas-report.json` (生成于 2025-12-05)

| Operation             | Gas           | ETH          | USD    | vs USDT       |
| --------------------- | ------------- | ------------ | ------ | ------------- |
| **ERC20 Transfer**    | **34,520**    | **0.000007** | $0.028 | **Baseline**  |
| Deposit (first)       | 106,556       | 0.000021     | $0.085 | +3.1x         |
| Deposit (subsequent)  | 55,256        | 0.000011     | $0.044 | +1.6x         |
| **Transfer (first)**  | **1,364,771** | **0.000273** | $1.09  | **+39.5x** ⚠️ |
| **Transfer (subseq)** | **36,979**    | **0.000007** | $0.030 | **+1.07x ✅** |
| Remint (first + ZK)   | 1,045,202     | 0.000209     | $0.84  | +30.3x        |
| Remint (subsequent)   | 78,955        | 0.000016     | $0.063 | +2.3x         |
| Withdraw              | 52,850        | 0.000011     | $0.042 | +1.5x         |

**Key Findings**:

- ✅ **Subsequent transfer**: 36,979 vs 34,520 gas (仅多 7.1%)
- ✅ **First receipt 是一次性成本** ($1.09), 为该地址提供永久隐私
- ✅ 在 L2 (如 Arbitrum, Optimism) 上成本可降低 10-100x
- 📊 **Detailed Reports**:
  - [GAS_ANALYSIS_REPORT.md](./GAS_ANALYSIS_REPORT.md) - Gas cost analysis
  - [ZK_PROFILE_REPORT.md](./ZK_PROFILE_REPORT.md) - ZK proof performance & mobile compatibility

---

## 🏗️ Architecture Design

### Workflow

```
1. Deposit → Receive ZWToken (no commitment)
2. Transfer → If recipient receives for first time, automatically generate commitment
   ├─ Calculate commitment = Poseidon(address, amount)
   ├─ Insert into 20-layer Merkle tree
   └─ Gas: First 1,364,771 / Subsequent 36,979 (from gas-report.json)
3. Remint → ZK proof + withdrawal
   ├─ Browser generates proof (875ms desktop, ~3s mobile - from zk-profile.json)
   ├─ Verify commitment in Merkle tree
   └─ Transfer out underlying token or mint ZWToken
```

### ZK Circuit

```circom
// circuits/remint.circom
// 20-layer Poseidon Merkle tree

Proves:
✅ User knows the secret for an address
✅ That address has a first receipt record (commitment in tree)
✅ remintAmount <= commitAmount
✅ nullifier prevents double-spending
```

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Compile Circuit

```bash
# First download powersOfTau28_hez_final_15.ptau
wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_15.ptau

# Compile circuit and generate verifier
chmod +x scripts/build_circuit.sh
./scripts/build_circuit.sh
```

### 3. Deploy Contracts

```bash
# Compile contracts
npx hardhat compile

# Deploy to local testnet
npx hardhat run scripts/deploy.js --network localhost

# Or deploy to mainnet/L2
npx hardhat run scripts/deploy.js --network mainnet
```

### 4. Run Tests

```bash
# Run all tests
npx hardhat test

# Run specific tests
npx hardhat test test/commitment.test.js       # Commitment functionality tests
npx hardhat test test/e2e.test.js              # E2E tests
npx hardhat test test/remint.test.js           # Remint functionality tests
npx hardhat test test/gas-profile.test.js      # Gas analysis tests
npx hardhat test test/zk-profile.test.js       # ZK performance tests

# Generate reports
npm run test:gas-profile                        # Generate gas-report.json
npm run test:zk-profile                         # Generate zk-profile.json

# View Gas report
REPORT_GAS=true npx hardhat test
```

---

## 📖 Usage Guide

### As a User

#### 1. Get ZWToken

```javascript
const { ZWERC20 } = require("./artifacts/contracts/ZWERC20.sol/ZWERC20.json");

// Deposit underlying token
await underlyingToken.approve(zwToken.address, amount);
await zwToken.deposit(recipientAddress, 0, amount); // (to, id, amount)
```

#### 2. Transfer to Privacy Address

```javascript
const { poseidon } = require("circomlibjs");

// Generate privacy address
const secret = randomBigInt(); // User keeps this safe
const addrScalar = poseidon([secret]);
const addr20 = addrScalar & ((1n << 160n) - 1n);
const privacyAddress = "0x" + addr20.toString(16).padStart(40, "0");

// Transfer (first receipt generates commitment)
await zwToken.transfer(privacyAddress, amount);
```

#### 3. Remint (Browser Generates Proof)

```javascript
const snarkjs = require("snarkjs");

// Generate ZK proof (browser, 5-12 seconds)
const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  circuitInput,
  "remint.wasm",
  "remint_final.zkey"
);

// Format proof
const calldata = await snarkjs.groth16.exportSolidityCallData(
  proof,
  publicSignals
);

// Submit remint
await zwToken.remint(
  recipientAddress, // to
  0, // id (0 for ERC-20)
  remintAmount, // amount
  false, // withdrawUnderlying
  {
    // RemintData struct
    commitment: root,
    nullifiers: [nullifier],
    proverData: "0x",
    relayerData: "0x",
    proof: proofBytes,
  }
);
```

---

## 🛠️ Tech Stack

### Smart Contracts

- Solidity ^0.8.20
- OpenZeppelin Contracts
- Poseidon-Solidity

### ZK Circuit

- Circom 2.1.6
- circomlib
- snarkjs (Groth16)

### Frontend

- ethers.js v6
- snarkjs (browser)
- circomlibjs
- Self-implemented Incremental Merkle Tree

---

## 📂 Project Structure

```
ZWToken/
├── circuits/
│   ├── remint.circom                      # Main circuit (~12K constraints)
│   └── out/                               # Compiled output
│       ├── remint.wasm                    # Proof generator
│       ├── remint_final.zkey              # Verification key (~12MB)
│       └── verification_key.json          # Public parameters
│
├── contracts/
│   ├── ZWERC20.sol                        # Main contract ⭐
│   ├── Groth16Verifier.sol                # ZK verifier (generated by snarkjs)
│   ├── interfaces/                        # Interface definitions
│   │   ├── IERC8065.sol                   # ERC-8065 interface
│   │   └── ISnarkVerifier.sol             # ZK verifier interface
│   ├── utils/
│   │   └── PoseidonMerkleTree.sol         # Poseidon Merkle Tree implementation
│   └── mocks/                             # Test helper contracts
│       ├── MockVerifier.sol               # Mock ZK verifier
│       └── ERC20Mock.sol                  # Mock ERC20 token
│
├── utils/
│   └── merkle-tree-utils.js               # Merkle Tree JS utilities
│
├── test/
│   ├── commitment.test.js                 # Commitment functionality tests
│   ├── e2e.test.js                        # E2E tests
│   ├── remint.test.js                     # Remint functionality tests
│   ├── gas-profile.test.js                # Gas analysis tests
│   └── zk-profile.test.js                 # ZK performance tests
│
├── scripts/
│   ├── build_circuit.sh                   # Circuit compilation script
│   └── deploy.js                          # Deployment script
│
├── website/                               # Frontend Web Application
│
└── deployments/                           # Deployment records
```

---

## 🔒 Security Considerations

### Privacy Protection

- ✅ Address and amount are private inputs, not on-chain
- ✅ Secret never leaves user's device
- ✅ Commitment is Poseidon hash, cannot be reversed
- ✅ ZK proof ensures no information leakage

### Attack Prevention

- ✅ Nullifier prevents double-spending (each address can only claim once)
- ✅ Historical root support (prevents front-running)
- ✅ Amount range validation (claimAmount <= firstAmount)
- ✅ ZK proof enforces honesty

### Known Limitations

- ⚠️ Only records first receipt (subsequent receipts don't generate new commitment)
- ⚠️ User must safeguard secret (cannot recover if lost)
- ⚠️ First receipt Gas: 1,364,771 (from `gas-report.json`, 包含 Merkle tree 插入)

---

## 📈 Comparison Analysis

### vs Original Approach (Ethereum MPT + Keccak256)

**原方案**：直接使用以太坊的 Merkle Patricia Trie (MPT) 存储 commitment，ZK proof 基于 MPT state proof 生成。

```
原方案（MPT + Keccak256）:
├── Commitment 存储在合约 storage (Ethereum MPT)
├── ZK circuit 需验证 MPT state proof
├── MPT 使用 Keccak256 哈希
│   └── Keccak256 在 ZK 中约束极高（~150K/hash）
│   └── MPT proof 需多次 Keccak256（深度 ~40）
└── 总约束: ~3,000,000+ (浏览器不可行)

ZWToken 方案（自定义 Poseidon Tree）:
├── Commitment 存储在自定义 Merkle Tree (链上数组)
├── ZK circuit 验证 Poseidon Merkle proof
├── Poseidon 是 ZK-friendly 哈希
│   └── Poseidon 在 ZK 中约束低（~300/hash）
│   └── 20 层树仅需 20 次 Poseidon
└── 总约束: 13,084 (浏览器友好)
```

| Dimension           | MPT + Keccak256 | ZWToken (Poseidon) | Trade-off        |
| ------------------- | --------------- | ------------------ | ---------------- |
| Circuit Constraints | ~3,000,000+     | **13,084** ✅      | **-99.6%**       |
| Proof Time          | 5-15 分钟+      | **875ms** ✅       | **~500x faster** |
| Browser Support     | ❌ Not feasible | ✅ **Perfect**     | 从不可用到完美   |
| First Receipt Gas   | ~35K (MPT 自动) | 1,364,771          | +3,848% ⚠️       |
| 链上存储成本        | 低（自动）      | 高（显式 Merkle）  | Trade-off ⚠️     |

> 📊 **数据来源**:
>
> - ZWToken 约束数: 13,084 (from `snarkjs r1cs info` 实测)
> - ZWToken Proof 时间: 875ms desktop, 3063ms mobile (from `zk-profile.json` 实测)
> - ZWToken Gas: 1,364,771 (from `gas-report.json` 实测)
> - MPT 约束数: ~3M (估算，基于 Keccak256 约束数 ~150K × MPT 深度 ~40)

**核心 Trade-off**:

使用自定义 Poseidon Merkle Tree 需要**额外的链上 Gas 成本**：

- **首次 transfer**: 1,364,771 gas (vs ERC20 的 34,520 gas)
  - 包含：Poseidon hash 计算 + 20 层 Merkle tree 插入
  - 一次性成本：~$1.09 (0.2 Gwei, $4000/ETH)
- **后续 transfer**: 36,979 gas (vs ERC20 的 34,520 gas)
  - 仅增加 7.1%，几乎无额外成本

**换来的收益**：

- ✅ 浏览器端 ZK proof 生成可行（875ms vs 不可能）
- ✅ 移动端兼容（~3s vs 不可能）
- ✅ 无需信任后端服务器
- ✅ 完全去中心化的隐私方案

**结论**: 在 0.2 Gwei 的 Gas 环境下，用户愿意支付 $1.09 的一次性成本，换取浏览器端完全自主的隐私保护能力。

### vs Batch Submission Solution

| Dimension                 | Batch Submission  | Direct Update | Advantage |
| ------------------------- | ----------------- | ------------- | --------- |
| Implementation Complexity | High              | **Low**       |           |
| User Experience           | Need to wait      | **Instant**   |           |
| First Receipt Gas         | ~95K              | ~820K         | Batch     |
| Protocol Cost             | Need incentivizer | **None**      |           |

**Conclusion**: At 0.2 Gwei, users are willing to pay $0.33 for simplicity and instant confirmation - **Choose Direct Update**

---

## 🎯 Use Cases

### ✅ Suitable For

- Privacy transfer applications
- Airdrop/reward distribution (records first receipt)
- L2 deployment (lower gas)
- dApps requiring browser proof generation
- Consumer-facing applications

### ⚠️ Less Suitable For

- Scenarios requiring multiple claims to same address
- Networks with extremely high gas prices (like mainnet during peak)
- Scenarios requiring merging multiple receipts

---

## 🤝 Contributing

Issues and Pull Requests are welcome!

---

## 📄 License

MIT License - See [LICENSE](LICENSE)

---

## 📚 Related Resources

### Project Documentation

- [Project Structure](PROJECT_STRUCTURE.md) - Project directory structure
- [Contract Documentation](contracts/README.md) - Smart contract details
- [Gas Analysis Report](GAS_ANALYSIS_REPORT.md) - Gas cost analysis
- [ZK Profile Report](ZK_PROFILE_REPORT.md) - ZK proof performance & mobile compatibility
- [Deployment Guide](DEPLOYMENT_GUIDE.md) - Deployment instructions

### Technical References

- [Circom Documentation](https://docs.circom.io/) - Zero-knowledge circuit language
- [snarkjs Documentation](https://github.com/iden3/snarkjs) - ZK proof generation tool
- [Poseidon Hash](https://www.poseidon-hash.info/) - ZK-friendly hash function
- [Groth16 Paper](https://eprint.iacr.org/2016/260.pdf) - ZK proof system

---

## 💬 Contact

- Issues: [GitHub Issues](https://github.com/your-repo/issues)
- Discussions: [GitHub Discussions](https://github.com/your-repo/discussions)

---

<div align="center">

---

## 🎉 Project Achievements

**Browser-Friendly ZK Circuit** (13,084 constraints, snarkjs 实测)  
**Fast Proof Generation** (875ms desktop, 3.1s mobile - zk-profile.json 实测)  
**Complete Test Coverage** (All tests passing, including real ZK proofs)  
**Mobile Browser Compatible** (✅ Works on all modern devices)  
**Production Ready** (Gas optimized, fully documented)

---

**🎉 Making Privacy ZK a Reality in the Browser!**

Made with ❤️ using Circom, Solidity, and ethers.js

**Last Updated**: 2025-10-12  
**License**: MIT

</div>

---

## 📝 Update History

### 2.0.0 (2025-10-12)

- ✅ Official production-ready release
- ✅ Complete code comments and documentation
- ✅ 25 tests all passing (with real ZK proofs)
- ✅ Clean architecture, easy to understand and extend
- ✅ Complete project documentation system
- ✅ Transparent gas cost explanation

### 1.0.0-beta (2025-10)

- ✅ Circuit design completed (12,166 constraints)
- ✅ Poseidon Merkle tree implementation
- ✅ Browser proof generation verified (5-12 seconds)
- ✅ Complete documentation written
- ✅ Basic test coverage

---

## 📦 Deployment Records

### Sepolia - 11/6/2025, 3:53:20 PM

**Contract Addresses:**

- PoseidonT3: [`0xABCEffcB2b5fD8958A9358eC6c218F91b7bA0A62`](https://sepolia.etherscan.io/address/0xABCEffcB2b5fD8958A9358eC6c218F91b7bA0A62)
- Verifier: [`0xaB165da0aB5D12C0D75ff49b53319fff60140C51`](https://sepolia.etherscan.io/address/0xaB165da0aB5D12C0D75ff49b53319fff60140C51)
- ZWERC20: [`0xFdb64908218B900585571218a77a0a1B47c537e7`](https://sepolia.etherscan.io/address/0xFdb64908218B900585571218a77a0a1B47c537e7)
- Underlying Token (USDC): [`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`](https://sepolia.etherscan.io/address/0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238)

**Token Info:**

- Name: Zero Knowledge Wrapper USDC
- Symbol: ZWUSDC
- Decimals: 6

**Fee Configuration:**

- Fee Collector: `0xb54cCfa7eDFcF0236D109fe9e7535D3c7b761cCb`
- Fee Denominator: 1000000
- Deposit Fee: 0 (0.00%)
- Remint Fee: 0 (0.00%)
- Withdraw Fee: 0 (0.00%)

**Deployer:** `0xb54cCfa7eDFcF0236D109fe9e7535D3c7b761cCb`
