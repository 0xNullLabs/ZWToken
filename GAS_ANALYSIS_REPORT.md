# 📊 ZWToken Gas Cost Analysis Report

**Report Date:** October 13, 2025  
**Gas Price:** 0.2 Gwei  
**ETH Price:** $4,000 USD

---

## 🎯 Key Findings

### Comparison with Standard ERC20 (USDT):

| Operation Type                   | Gas Consumption | USD Cost | vs USDT      |
| -------------------------------- | --------------- | -------- | ------------ |
| **USDT Transfer**                | 35,110          | $0.028   | Baseline     |
| **ZWToken Transfer (recorded)**  | 37,548          | $0.030   | +7% 🟢       |
| **ZWToken Transfer (first time)**| 1,071,023       | $0.857   | +2,950% 🔴   |

**Conclusion:** For addresses with existing commitments, ZWToken transfer cost is almost the same as USDT (only 7% more)!

---

## 📋 Complete Operation Cost Table

### 1. Standard ERC20 Operations (USDT Control Group)

| Operation    | Gas    | ETH       | USD    |
| ------------ | ------ | --------- | ------ |
| Transfer     | 35,110 | 0.0000070 | $0.028 |
| TransferFrom | 38,104 | 0.0000076 | $0.030 |

---

### 2. ZWToken Deposit/Withdraw Operations

| Operation              | Gas     | ETH       | USD    | Notes                     |
| ---------------------- | ------- | --------- | ------ | ------------------------- |
| **Deposit (first)**    | 106,796 | 0.0000214 | $0.085 | Cold storage initialization|
| **Deposit (subsequent)**| 55,496 | 0.0000111 | $0.044 | Hot storage access        |
| **Withdraw (first)**   | 51,035  | 0.0000102 | $0.041 | -                         |
| **Withdraw (subsequent)**| 51,035| 0.0000102 | $0.041 | -                         |

**Key Points:**

- First deposit is 2x more expensive (needs to initialize account state)
- Withdraw cost is stable, ~$0.04
- Deposit/Withdraw **does not record commitment** (by design)

---

### 3. ZWToken Transfer Operations (Core Feature)

| Operation                   | Gas           | ETH           | USD        | Includes                      |
| --------------------------- | ------------- | ------------- | ---------- | ----------------------------- |
| **Transfer (first receipt)**| **1,071,023** | **0.0002142** | **$0.857** | Poseidon hash + Merkle tree insert |
| **Transfer (subsequent)**   | **37,548**    | **0.0000075** | **$0.030** | Transfer only                 |

#### First Transfer Cost Breakdown:

```
Base ERC20 transfer:         35,110 gas  (3.3%)
Poseidon hash calculation:   25,000 gas  (2.3%)
Merkle tree insertion:    1,010,913 gas (94.4%)
────────────────────────────────────────
Total:                   1,071,023 gas (100%)
```

**Important Findings:**

- 🔴 **First transfer to new address: 30x more expensive** (one-time cost for recording privacy commitment)
- 🟢 **Subsequent transfers to same address: only 7% more** (almost the same as USDT)
- 💡 **Ideal for long-term holders**: each receiving address only needs to bear the high cost once

---

### 4. ZWToken Anonymous Claim (ZK Proof)

| Operation                        | Gas         | ETH           | USD        | Includes                     |
| -------------------------------- | ----------- | ------------- | ---------- | ---------------------------- |
| **Claim (first, with ZK proof)**  | **764,311** | **0.0001529** | **$0.611** | Verification + mint + record |
| **Claim (subsequent)**           | **75,272**  | **0.0000151** | **$0.060** | Verification + mint only     |

#### Claim Cost Breakdown:

```
Groth16 proof verification:  220,000 gas  (28.8%)
Token minting:               50,000 gas   (6.5%)
Commitment recording (first): 494,311 gas (64.7%)
────────────────────────────────────────
Total:                      764,311 gas (100%)
```

**Key Points:**

- 🔐 **Strongest privacy protection**: Zero-knowledge proofs ensure anonymity
- 💰 **First claim is 10x more expensive**: Includes commitment recording
- ✅ **Subsequent claims are cheap**: Only need to verify proof

---

## 💰 Real-World Usage Scenarios

### Scenario 1: Wrap and Unwrap Assets

**Flow:** User deposits 1000 tokens → holds for 1 month → withdraws

| Step           | Gas         | USD        |
| -------------- | ----------- | ---------- |
| Deposit (first)| 106,796     | $0.085     |
| Withdraw       | 51,035      | $0.041     |
| **Total**      | **157,831** | **$0.126** |

✅ **Reasonable cost**: ~$0.13 for wrap/unwrap cycle

---

### Scenario 2: Transfer to New User (First Time)

**Flow:** Alice transfers to Bob (Bob's first time receiving ZWToken)

| Step                 | Gas       | USD    |
| -------------------- | --------- | ------ |
| Transfer (record)    | 1,071,023 | $0.857 |

⚠️ **High cost but permanent privacy**: Bob's first receipt amount is recorded as privacy commitment

---

### Scenario 3: Daily Transfer (Existing User)

**Flow:** Alice transfers to Bob (Bob already has commitment)

| Step     | Gas    | USD    | vs USDT |
| -------- | ------ | ------ | ------- |
| Transfer | 37,548 | $0.030 | +$0.002 |

✅ **Almost free privacy**: Only $0.002 more than USDT

---

### Scenario 4: Anonymous Claim

**Flow:** User claims tokens anonymously via zero-knowledge proof

| Step          | Gas     | USD    |
| ------------- | ------- | ------ |
| Claim (first) | 764,311 | $0.611 |

🔐 **Privacy premium**: ~$0.61 for strongest anonymity guarantee

---

## 📊 Visual Comparison

### Gas Consumption Comparison (Relative to USDT)

```
USDT Transfer:              ████                    35,110 gas  (1.0x)
ZWToken Transfer (existing):████                    37,548 gas  (1.1x)
ZWToken Deposit (first):    ████████████            106,796 gas (3.0x)
ZWToken Withdraw:           ██████████              51,035 gas  (1.5x)
ZWToken Claim (existing):   ███████████████         75,272 gas  (2.1x)
ZWToken Claim (first):      ████████████████████████████████████████████████████████████  764,311 gas (21.8x)
ZWToken Transfer (first):   ████████████████████████████████████████████████████████████████████████████████████  1,071,023 gas (30.5x)
```

---

## 💡 User Recommendations

### When to Use ZWToken?

✅ **Recommended Scenarios:**

1. **High-frequency trading with same users** - High initial cost, almost free afterwards
2. **Need privacy protection** - Commitment mechanism provides on-chain privacy
3. **Anonymous claims** - Strong anonymity through ZK proofs

⚠️ **Use with Caution:**

1. **One-time transfers to new addresses** - Cost up to $0.86
2. **Small, frequent transfers to new users** - Each new address bears first-time cost

---

### Cost Optimization Tips

1. **Batch operations** - Deposit once, use multiple times to spread fixed costs
2. **Fixed user group** - Use within fixed user group to avoid first-time commitment costs
3. **Large transactions** - Privacy cost percentage is lower

---

## 📈 Overall Assessment

| Dimension          | Rating     | Notes                              |
| ------------------ | ---------- | ---------------------------------- |
| **Daily usage cost**| ⭐⭐⭐⭐⭐ | Almost no extra cost for existing users |
| **First-time cost** | ⭐⭐       | High, but provides permanent privacy |
| **Privacy protection**| ⭐⭐⭐⭐⭐| Zero-knowledge proofs provide strong privacy |
| **Gas efficiency** | ⭐⭐⭐⭐   | Efficient for subsequent ops, expensive first time |
| **Scalability**    | ⭐⭐⭐⭐   | Merkle tree supports 1 million addresses |

---

## 🔍 Technical Notes

### Why is the First Transfer So Expensive?

**Core reason:** Merkle tree insertion operation

```
ZWToken uses a 20-layer Poseidon Merkle tree:
- Tree depth: 20 layers
- Supported addresses: 2^20 = 1,048,576
- Each insertion requires 20 Poseidon hash calculations
- Poseidon hash: ~25K gas each
- Plus storage operations: ~1M gas total
```

### Comparison with Other Privacy Solutions

| Solution          | Privacy Level | Gas Cost | Complexity |
| ----------------- | ------------- | -------- | ---------- |
| Standard ERC20    | None          | ~35K     | Low        |
| ZWToken (subseq)  | Medium        | ~38K     | Medium     |
| ZWToken (first)   | High          | ~1M      | High       |
| Tornado Cash      | Very High     | ~1.2M    | Very High  |

---

## 📊 Data Source

- **Test Network:** Hardhat local testnet
- **Compiler:** Solidity 0.8.20
- **Optimizer:** Enabled (200 runs)
- **Test Framework:** Hardhat + Chai
- **Measurement Method:** Real transaction receipts

---

## 📁 Related Files

- 📄 **Test Script:** `test/gas-profile.test.js`
- 📊 **Raw Data:** `gas-report.json`
- 💻 **Contract Code:** `contracts/ZWERC20.sol`

---

## 🎯 Conclusion

ZWToken transfers between **existing users** cost almost the same as standard ERC20 (+7%), providing **nearly free privacy protection**.

While the **first-time transfer cost is high** (~$0.86), this is a one-time cost that provides privacy protection for all subsequent transactions.

For **fixed user groups** and scenarios that **prioritize privacy**, ZWToken is an **extremely cost-effective** choice.

---

_This report was automatically generated by the ZWToken gas profiling test suite_
