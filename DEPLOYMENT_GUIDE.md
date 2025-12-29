# Deployment Guide

## 📦 Multi-Contract Deployment

The deployment script supports deploying multiple ZWToken contracts from a JSON configuration file:

- **ZWERC20**: Wraps ERC-20 tokens
- **ZWERC721**: Wraps ERC-721 NFTs
- **ZWERC1155**: Wraps ERC-1155 tokens
- **ZWETH**: Wraps native ETH

Each token has its own `verifier` and `feeConfig`. Deployed addresses are automatically written back to the config file.

### Quick Start

```bash
# 1. Copy example config
cp deploy.config.example.json deploy.config.json

# 2. Edit configuration
vim deploy.config.json

# 3. Deploy
npx hardhat run scripts/deploy.js --network sepolia
```

## 🔧 Configuration

### Environment Variables (Sensitive Data Only)

| Variable            | Description                               | Required |
| ------------------- | ----------------------------------------- | -------- |
| `PRIVATE_KEY`       | Deployer account private key              | Yes      |
| `*_RPC_URL`         | Network RPC URL (e.g., `SEPOLIA_RPC_URL`) | Yes      |
| `ETHERSCAN_API_KEY` | API key for contract verification         | No       |
| `DEPLOY_CONFIG`     | Path to JSON config file                  | No       |

### JSON Configuration File

Create a `deploy.config.json` file:

```json
{
  "poseidonT3": null,
  "tokens": [
    {
      "type": "ZWETH",
      "name": "ZK Wrapper ETH",
      "symbol": "ZWETH",
      "address": null,
      "verifier": null,
      "feeConfig": {
        "depositFee": 0,
        "withdrawFee": 0
      }
    }
  ]
}
```

### Configuration Fields

#### Root Level

| Field        | Type   | Description                                    |
| ------------ | ------ | ---------------------------------------------- |
| `poseidonT3` | string | PoseidonT3 library address (null = deploy new) |
| `tokens`     | array  | Array of token configurations                  |

#### Token Configuration

| Field        | Type   | Required | Description                                            |
| ------------ | ------ | -------- | ------------------------------------------------------ |
| `type`       | string | Yes      | Token type: ZWERC20, ZWERC721, ZWERC1155, ZWETH        |
| `name`       | string | No       | Token name (auto-generated if not set)                 |
| `symbol`     | string | No       | Token symbol (auto-generated if not set)               |
| `address`    | string | No       | Deployed address (null = deploy, set = skip)           |
| `verifier`   | string | No       | Verifier address (null = deploy new)                   |
| `underlying` | string | Depends  | Underlying token address (required for ERC20/721/1155) |
| `uri`        | string | No       | Base URI for ERC1155 metadata                          |
| `feeConfig`  | object | No       | Token-specific fee configuration                       |

#### Fee Configuration (Per Token)

| Field            | Type   | Default          | Description                         |
| ---------------- | ------ | ---------------- | ----------------------------------- |
| `feeCollector`   | string | Deployer address | Address that receives protocol fees |
| `feeDenominator` | number | 10000            | Fee denominator (10000 = 100%)      |
| `depositFee`     | number | 0                | Deposit fee in basis points         |
| `remintFee`      | number | 0                | Remint fee in basis points          |
| `withdrawFee`    | number | 0                | Withdraw fee in basis points        |
| `minDepositFee`  | number | 0                | Minimum absolute deposit fee        |
| `minWithdrawFee` | number | 0                | Minimum absolute withdraw fee       |
| `minRemintFee`   | number | 0                | Minimum absolute remint fee         |

## 📋 Configuration Examples

### Example 1: Single ZWETH

```json
{
  "tokens": [
    {
      "type": "ZWETH",
      "address": null,
      "verifier": null
    }
  ]
}
```

### Example 2: Multiple Tokens with Different Verifiers

```json
{
  "tokens": [
    {
      "type": "ZWETH",
      "address": null,
      "verifier": null,
      "feeConfig": { "depositFee": 0 }
    },
    {
      "type": "ZWERC20",
      "underlying": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      "name": "Private USDC",
      "symbol": "pUSDC",
      "address": null,
      "verifier": null,
      "feeConfig": { "depositFee": 10, "withdrawFee": 10 }
    },
    {
      "type": "ZWERC20",
      "underlying": "0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0",
      "name": "Private USDT",
      "symbol": "pUSDT",
      "address": null,
      "verifier": null,
      "feeConfig": { "depositFee": 20, "withdrawFee": 20 }
    }
  ]
}
```

### Example 3: Share Existing Verifier

After first deployment, reuse the deployed verifier:

```json
{
  "poseidonT3": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  "tokens": [
    {
      "type": "ZWETH",
      "address": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
      "verifier": "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
    },
    {
      "type": "ZWERC20",
      "underlying": "0x...",
      "address": null,
      "verifier": "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
    }
  ]
}
```

### Example 4: All Token Types

```json
{
  "tokens": [
    {
      "type": "ZWETH",
      "address": null,
      "verifier": null,
      "feeConfig": { "depositFee": 10 }
    },
    {
      "type": "ZWERC20",
      "underlying": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      "address": null,
      "verifier": null
    },
    {
      "type": "ZWERC721",
      "underlying": "0xYourNFTContract",
      "address": null,
      "verifier": null
    },
    {
      "type": "ZWERC1155",
      "underlying": "0xYourERC1155",
      "uri": "https://api.example.com/{id}.json",
      "address": null,
      "verifier": null
    }
  ]
}
```

## 📊 Deployment Behavior

### First Deployment

```
================================================================================
🚀 Starting ZWToken Multi-Contract Deployment
================================================================================

📄 Loaded configuration: deploy.config.json
   2 token(s) configured

📍 Deployer: 0xb54c...
💰 Balance: 0.5 ETH

────────────────────────────────────────────────────────────────────────────────
📦 Shared Infrastructure
────────────────────────────────────────────────────────────────────────────────
🔧 Deploying PoseidonT3 Library...
✅ PoseidonT3 deployed to: 0xABC...

[1] ZWETH (ZWETH)
────────────────────────────────────────────────────────────
   🔧 Deploying Groth16Verifier...
   ✅ Groth16Verifier deployed to: 0xDEF...
   ✅ ZWETH deployed: 0x123...

[2] ZWERC20 (ZWUSDC)
────────────────────────────────────────────────────────────
   🔧 Deploying Groth16Verifier...
   ✅ Groth16Verifier deployed to: 0xGHI...
   Underlying: 0x1c7D...
   └─ Name: USDC | Symbol: USDC
   ✅ ZWERC20 deployed: 0x456...

📝 Configuration updated: deploy.config.json

================================================================================
🎉 Deployment Complete!
================================================================================

📋 Summary:
────────────────────────────────────────────────────────────
PoseidonT3:     0xABC...
ZWETH:          0x123... (new)
  └─ Verifier:  0xDEF...
ZWERC20:        0x456... (new)
  └─ Underlying: 0x1c7D...
  └─ Verifier:  0xGHI...
────────────────────────────────────────────────────────────
📊 Deployed: 2 | Skipped: 0
```

### Re-run (Skips Deployed)

```
[1] ZWETH (ZWETH)
────────────────────────────────────────────────────────────
   ⏭️  Already deployed: 0x123...

[2] ZWERC20 (ZWUSDC)
────────────────────────────────────────────────────────────
   ⏭️  Already deployed: 0x456...

────────────────────────────────────────────────────────────
📊 Deployed: 0 | Skipped: 2
```

## 📁 Output Files

### Config File (Updated After Deployment)

```json
{
  "poseidonT3": "0xABC...",
  "tokens": [
    {
      "type": "ZWETH",
      "name": "ZK Wrapper ETH",
      "symbol": "ZWETH",
      "address": "0x123...",
      "verifier": "0xDEF...",
      "feeConfig": { ... }
    }
  ]
}
```

### Deployment Record

```
deployments/
├── deployment-sepolia-{timestamp}.json
└── latest-sepolia.json
```

## 🌐 Supported Networks

| Network  | Block Explorer                  |
| -------- | ------------------------------- |
| mainnet  | https://etherscan.io            |
| sepolia  | https://sepolia.etherscan.io    |
| arbitrum | https://arbiscan.io             |
| optimism | https://optimistic.etherscan.io |
| polygon  | https://polygonscan.com         |
| bsc      | https://bscscan.com             |

## 🔍 Etherscan Verification

When `ETHERSCAN_API_KEY` is set, newly deployed contracts are automatically verified.

## 🔒 Security

1. **Do not commit `.env`** - Contains private keys
2. **Review `deploy.config.json`** - Contains deployed addresses
3. **Use multisig** - For production fee collectors
4. **Audit first** - Before mainnet deployment

## 📚 Files

- [deploy.config.example.json](./deploy.config.example.json) - Example config
- [deployments/](./deployments/) - Deployment records
- [scripts/deploy.js](./scripts/deploy.js) - Deployment script
