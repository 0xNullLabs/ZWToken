# Deployment Guide

## 📦 Automatic Deployment Records

The deployment script now automatically records detailed information for each deployment and syncs updates to README.md.

### Features

1. **Incremental Records** - Does not delete historical deployment records
2. **Multi-network Support** - Automatically identifies network and generates corresponding block explorer links
3. **Dual Storage** - JSON file + README.md update

### Deployment Record Storage

Each deployment generates the following files:

```
deployments/
├── deployment-{network}-{timestamp}.json  # Historical deployment records
└── latest-{network}.json                  # Latest deployment (overwrite)
```

### Supported Networks

| Network         | Block Explorer                          |
| --------------- | --------------------------------------- |
| mainnet         | https://etherscan.io                    |
| sepolia         | https://sepolia.etherscan.io            |
| goerli          | https://goerli.etherscan.io             |
| arbitrum        | https://arbiscan.io                     |
| arbitrumSepolia | https://sepolia.arbiscan.io             |
| optimism        | https://optimistic.etherscan.io         |
| optimismSepolia | https://sepolia-optimistic.etherscan.io |
| polygon         | https://polygonscan.com                 |
| polygonMumbai   | https://mumbai.polygonscan.com          |
| bsc             | https://bscscan.com                     |
| bscTestnet      | https://testnet.bscscan.com             |
| hardhat         | No explorer                             |
| localhost       | No explorer                             |

### Deployment Record Contents

Each deployment record contains:

- **Network Info**: Network name, deployment time
- **Contract Addresses**: PoseidonT3, Verifier, ZWERC20, Underlying Token
- **Token Info**: Name, symbol, decimals
- **Fee Configuration**: Fee collector, various fee rates
- **Deployer Account**: Deployer address

### Usage Examples

#### 1. Deploy to Sepolia

```bash
npx hardhat run scripts/deploy.js --network sepolia
```

Output example:

```
================================================================================
🚀 Starting ZWERC20 Contract Deployment
================================================================================

📍 Deployer Account: 0xb54cCfa7eDFcF0236D109fe9e7535D3c7b761cCb
💰 Account Balance: 0.338139247778615935 ETH

...deployment process...

📝 Deployment info saved: deployments/deployment-sepolia-1730892000000.json
📝 Latest deployment info: deployments/latest-sepolia.json
📝 README.md deployment records updated

✅ Deployment records saved to deployments/ directory and README.md
```

#### 2. Deploy to Other Networks

```bash
# Mainnet
npx hardhat run scripts/deploy.js --network mainnet

# Arbitrum
npx hardhat run scripts/deploy.js --network arbitrum

# Optimism
npx hardhat run scripts/deploy.js --network optimism

# Polygon
npx hardhat run scripts/deploy.js --network polygon
```

#### 3. View Deployment History

```bash
# View all deployment records
ls -la deployments/

# View latest deployment for specific network
cat deployments/latest-sepolia.json

# View deployment records in README
tail -n 50 README.md
```

### README.md Deployment Record Format

Each deployment appends a new record to the "📦 Deployment Records" section in README.md:

```markdown
## 📦 Deployment Records

### Sepolia - 11/6/2025, 3:53:20 PM

**Contract Addresses:**

- PoseidonT3: [`0xABC...`](https://sepolia.etherscan.io/address/0xABC...)
- Verifier: [`0xDEF...`](https://sepolia.etherscan.io/address/0xDEF...)
- ZWERC20: [`0x123...`](https://sepolia.etherscan.io/address/0x123...)
- Underlying Token (USDC): [`0x456...`](https://sepolia.etherscan.io/address/0x456...)

**Token Info:**

- Name: Zero Knowledge Wrapper USDC
- Symbol: ZWUSDC
- Decimals: 6

**Fee Configuration:**

- Fee Collector: `0xb54...`
- Fee Denominator: 1000000
- Deposit Fee: 0 (0.00%)
- Remint Fee: 0 (0.00%)
- Withdraw Fee: 0 (0.00%)

**Deployer:** `0xb54...`
```

### JSON Record Format

```json
{
  "network": "sepolia",
  "timestamp": "2025-11-06T07:53:20.000Z",
  "deployer": "0xb54cCfa7eDFcF0236D109fe9e7535D3c7b761cCb",
  "addresses": {
    "poseidonT3": "0xABCEffcB2b5fD8958A9358eC6c218F91b7bA0A62",
    "underlying": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    "verifier": "0xaB165da0aB5D12C0D75ff49b53319fff60140C51",
    "zwToken": "0xFdb64908218B900585571218a77a0a1B47c537e7"
  },
  "tokenInfo": {
    "name": "Zero Knowledge Wrapper USDC",
    "symbol": "ZWUSDC",
    "decimals": "6",
    "underlyingName": "USDC",
    "underlyingSymbol": "USDC"
  },
  "feeConfig": {
    "feeCollector": "0xb54cCfa7eDFcF0236D109fe9e7535D3c7b761cCb",
    "feeDenominator": "1000000",
    "depositFee": "0",
    "remintFee": "0",
    "withdrawFee": "0"
  }
}
```

### Important Notes

1. **History Preserved**: All deployment records are preserved, filenames include timestamps
2. **README Updates**: Each deployment appends new records to README.md, does not delete old records
3. **Network Separation**: Deployment records for different networks are stored separately
4. **Block Explorer Links**: Correct explorer links are generated based on network
5. **Local Networks**: hardhat and localhost networks do not generate explorer links

### Environment Variable Configuration

Before deployment, ensure the following environment variables are configured (in `.env` file):

```bash
# Required
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
PRIVATE_KEY=your_private_key
UNDERLYING_TOKEN_ADDRESS=0x...

# Optional (fee configuration)
FEE_COLLECTOR=0x...           # Default: deployer account
FEE_DENOMINATOR=1000000       # Default: 1000000 (0.01% precision)
DEPOSIT_FEE=0                 # Default: 0
REMINT_FEE=0                  # Default: 0
WITHDRAW_FEE=0                # Default: 0
```

### Troubleshooting

#### Deployment Records Not Generated

Check if script executed successfully to completion:

```bash
# View full output
npx hardhat run scripts/deploy.js --network sepolia 2>&1 | tee deploy.log
```

#### README Not Updated

Manually run update function (requires deployment info):

```javascript
const deploymentInfo = require("./deployments/latest-sepolia.json");
updateReadmeDeployment(deploymentInfo);
```

#### Permission Issues

Ensure write permissions:

```bash
chmod +w README.md
chmod +w deployments/
```

## 🔒 Security Recommendations

1. **Do not commit .env file** - Ensure `.gitignore` includes `.env`
2. **Verify contract code** - Verify contracts on block explorer after deployment
3. **Small amount testing** - Test functionality with small amounts first
4. **Multisig wallet** - Recommend using multisig wallet as owner in production

## 📚 Related Documentation

- [README.md](./README.md) - Main project documentation
- [scripts/deploy.js](./scripts/deploy.js) - Deployment script source
- [hardhat.config.js](./hardhat.config.js) - Hardhat configuration
