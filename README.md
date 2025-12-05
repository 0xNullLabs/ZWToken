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

> 📊 Data Source: `zk-profile.json` (generated on 2025-12-05)

```
Constraints: 13,084 (measured value, from snarkjs r1cs info)
Circuit Files: 7.69 MB total (remint.wasm 2.14MB + zkey 5.55MB)

Browser Proof Generation (measured, 5-run average):
- Desktop: 875ms ✅
- Mobile (mid-range): ~3.1s ✅

Memory Usage: 6.13 MB total (browser-friendly)
```

### Gas Cost (0.2 Gwei, $4000/ETH)

> 📊 Data Source: `gas-report.json` (generated on 2025-12-05)

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

- ✅ **Subsequent transfer**: 36,979 vs 34,520 gas (only 7.1% more)
- ✅ **First receipt is a one-time cost** ($1.09), providing permanent privacy for this address
- ✅ Cost can be reduced 10-100x on L2 (such as Arbitrum, Optimism)
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
- ⚠️ First receipt Gas: 1,364,771 (from `gas-report.json`, includes Merkle tree insertion)

---

## 📈 Comparison Analysis

### vs Original Approach (Ethereum MPT + Keccak256)

**Original Approach**: Directly use Ethereum's Merkle Patricia Trie (MPT) to store commitments, with ZK proof based on MPT state proof generation.

```
Original Approach (MPT + Keccak256):
├── Commitment stored in contract storage (Ethereum MPT)
├── ZK circuit needs to verify MPT state proof
├── MPT uses Keccak256 hash
│   └── Keccak256 has extremely high constraints in ZK (~150K/hash)
│   └── MPT proof requires multiple Keccak256 (depth ~40)
└── Total constraints: ~3,000,000+ (not feasible in browser)

ZWToken Approach (Custom Poseidon Tree):
├── Commitment stored in custom Merkle Tree (on-chain array)
├── ZK circuit verifies Poseidon Merkle proof
├── Poseidon is ZK-friendly hash
│   └── Poseidon has low constraints in ZK (~300/hash)
│   └── 20-layer tree only needs 20 Poseidon hashes
└── Total constraints: 13,084 (browser-friendly)
```

| Dimension             | MPT + Keccak256      | ZWToken (Poseidon)     | Trade-off                  |
| --------------------- | -------------------- | ---------------------- | -------------------------- |
| Circuit Constraints   | ~3,000,000+          | **13,084** ✅          | **-99.6%**                 |
| Proof Time            | 5-15 minutes+        | **875ms** ✅           | **~500x faster**           |
| Browser Support       | ❌ Not feasible      | ✅ **Perfect**         | From infeasible to perfect |
| First Receipt Gas     | ~35K (MPT automatic) | 1,364,771              | +3,848% ⚠️                 |
| On-chain Storage Cost | Low (automatic)      | High (explicit Merkle) | Trade-off ⚠️               |

> 📊 **Data Sources**:
>
> - ZWToken Constraints: 13,084 (from `snarkjs r1cs info` measured)
> - ZWToken Proof Time: 875ms desktop, 3063ms mobile (from `zk-profile.json` measured)
> - ZWToken Gas: 1,364,771 (from `gas-report.json` measured)
> - MPT Constraints: ~3M (estimated, based on Keccak256 constraints ~150K × MPT depth ~40)

**Core Trade-off**:

Using a custom Poseidon Merkle Tree requires **additional on-chain Gas cost**:

- **First transfer**: 1,364,771 gas (vs ERC20's 34,520 gas)
  - Includes: Poseidon hash calculation + 20-layer Merkle tree insertion
  - One-time cost: ~$1.09 (0.2 Gwei, $4000/ETH)
- **Subsequent transfers**: 36,979 gas (vs ERC20's 34,520 gas)
  - Only 7.1% increase, almost no additional cost

**Benefits Gained**:

- ✅ Browser-side ZK proof generation is feasible (875ms vs impossible)
- ✅ Mobile compatibility (~3s vs impossible)
- ✅ No need to trust backend servers
- ✅ Fully decentralized privacy solution

**Conclusion**: At 0.2 Gwei gas environment, users are willing to pay $1.09 one-time cost in exchange for fully autonomous browser-based privacy protection capability.

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

We welcome contributions from the community! Whether you're reporting bugs, suggesting new features, improving documentation, or submitting code, we greatly appreciate your help.

### 💡 How to Contribute

#### Bug Reports

If you find a bug, please report it via [GitHub Issues](https://github.com/0xNullLabs/issues) and include:

- **Description**: Clear description of the issue
- **Steps to Reproduce**: How to reproduce the problem
- **Expected Behavior**: What you expected to happen
- **Actual Behavior**: What actually happened
- **Environment**: Node.js version, network, browser, etc.
- **Logs**: Error messages or console output

#### Feature Requests

Have a great idea? We'd love to hear it! Create an issue and describe:

- **Feature Description**: What feature you'd like to add
- **Use Case**: Why this feature is needed
- **Expected Outcome**: How this feature should work
- **Alternatives**: Any alternative solutions you've considered

#### Pull Requests

1. **Fork the repository** and clone it locally
2. **Create a new branch**: `git checkout -b feature/your-feature-name`
3. **Install dependencies**: `npm install`
4. **Make your changes** and ensure:
   - Code follows the existing style
   - Add necessary tests
   - All tests pass: `npm test`
   - Commit messages are clear and descriptive
5. **Push to your fork**: `git push origin feature/your-feature-name`
6. **Create a Pull Request** to the `main` branch

#### Documentation Improvements

Documentation improvements are valuable contributions! You can:

- Fix typos or grammatical errors
- Improve clarity of existing explanations
- Add more usage examples
- Translate documentation to other languages

### 📋 Development Guide

```bash
# Clone the repository
git clone https://github.com/0xNullLabs/ZWToken/issues
cd ZWToken

# Install dependencies
npm install

# Compile circuits (first time only)
./scripts/build_circuit.sh

# Compile contracts
npx hardhat compile

# Run tests
npx hardhat test

# Run specific tests
npx hardhat test test/e2e.test.js

# Generate gas report
npm run test:gas-profile

# Generate ZK performance report
npm run test:zk-profile
```

### 🎯 Code Guidelines

- **Solidity**: Follow the [Solidity Style Guide](https://docs.soliditylang.org/en/latest/style-guide.html)
- **JavaScript**: Use the ESLint configuration
- **Comments**: Add clear comments for complex logic
- **Tests**: Add tests for new features
- **Commit Messages**: Use clear commit messages (e.g., `feat: add batch deposit`, `fix: resolve merkle tree bug`)

### 🌟 Code of Conduct

We are committed to fostering an open and welcoming community. We expect all participants to:

- ✅ Be respectful and inclusive
- ✅ Accept constructive criticism gracefully
- ✅ Focus on what's best for the community
- ✅ Show empathy towards other community members

### 💬 Need Help?

- 📖 Check [Project Structure](PROJECT_STRUCTURE.md) to understand the codebase
- 📖 Read [Contract Documentation](contracts/README.md) for contract details
- 💬 Ask questions in [GitHub Discussions](https://github.com/0xNullLabs/ZWToken/discussions)
- 🐛 Report issues in [GitHub Issues](https://github.com/0xNullLabs/issues)

### 🙏 Acknowledgments

Thank you to all the developers who have contributed to ZWToken! Your contributions make this project better.

<!-- Contributors list will be automatically updated here -->

---

**Remember**: No contribution is too small. Even fixing a typo is a valuable contribution to the project! 🎉

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

- **X (Twitter)**: [@wallet_aa](https://x.com/wallet_aa)
- **Telegram Group**: [Join Discussion](https://t.me/+JzL6_HdgU_AzYjEx)
- **Ethereum Magicians**: [ERC-8065 Forum](https://ethereum-magicians.org/t/erc-8065-zero-knowledge-token-wrapper/26006)
- **Issues**: [GitHub Issues](https://github.com/0xNullLabs/issues)
- **Discussions**: [GitHub Discussions](https://github.com/0xNullLabs/discussions)

---

## 💝 Donation

If you believe in our vision to **"Make privacy a native feature of all tokens on Ethereum"**, we welcome your support!

**Ethereum Mainnet:**

```
0x8EA35dd88e2e7ec04a3C5F9B36Bd9eda90424a32
```

Your contributions help us continue building privacy infrastructure for the Ethereum ecosystem. Thank you! 🙏

---

<div align="center">

---

## 🎉 Project Achievements

**Browser-Friendly ZK Circuit** (13,084 constraints, measured by snarkjs)  
**Fast Proof Generation** (875ms desktop, 3.1s mobile - measured in zk-profile.json)  
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
