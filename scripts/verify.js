const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

/**
 * Verify deployed contracts on Etherscan
 *
 * Usage:
 *   npx hardhat run scripts/verify.js --network sepolia
 */

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🔍 Verifying Contracts on Etherscan");
  console.log("=".repeat(80));

  // Load deployment configuration
  const configPath = path.join(__dirname, "..", "deploy.config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuration file not found: ${configPath}`);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const poseidonT3Address = config.poseidonT3;

  const explorerBaseUrl = getExplorerUrl(hre.network.name);
  if (!explorerBaseUrl || !process.env.ETHERSCAN_API_KEY) {
    if (!explorerBaseUrl) {
      throw new Error(`No explorer for network: ${hre.network.name}`);
    } else {
      throw new Error("ETHERSCAN_API_KEY not set in .env file");
    }
  }

  console.log(`\n📍 Network: ${hre.network.name}`);
  console.log(`🔗 Explorer: ${explorerBaseUrl}`);

  // Wait for block confirmations
  console.log("\n⏳ Waiting for block confirmations...");
  await new Promise((resolve) => setTimeout(resolve, 20000));

  const libraries = { PoseidonT3: poseidonT3Address };

  const verifyContract = async (name, address, constructorArgs, libs = {}) => {
    console.log(`\n📦 Verifying ${name}...`);
    console.log(`   Address: ${address}`);
    try {
      await hre.run("verify:verify", {
        address,
        constructorArguments: constructorArgs || [],
        libraries: libs,
      });
      console.log(`✅ ${name} verified: ${explorerBaseUrl}/address/${address}`);
    } catch (error) {
      if (error.message.includes("Already Verified")) {
        console.log(`ℹ️  ${name} already verified`);
      } else {
        console.log(`⚠️  ${name} verification failed:`, error.message);
        throw error;
      }
    }
  };

  // Track verified verifiers to avoid duplicates
  const verifiedVerifiers = new Set();

  // Verify each token
  for (let i = 0; i < config.tokens.length; i++) {
    const token = config.tokens[i];
    const type = token.type?.toUpperCase();

    if (!token.address) {
      console.log(`\n⏭️  Skipping ${type}: No address in config`);
      continue;
    }

    console.log(`\n${"=".repeat(80)}`);
    console.log(`[${i + 1}] ${type} (${token.symbol || token.name})`);
    console.log("=".repeat(80));

    // Verify verifier (only once per address)
    if (token.verifier && !verifiedVerifiers.has(token.verifier)) {
      await verifyContract(`Groth16Verifier`, token.verifier, []);
      verifiedVerifiers.add(token.verifier);
    }

    // Build constructor arguments based on token type
    let constructorArgs;
    let contractName;

    // Build ZWConfig struct as tuple (for Solidity struct parameter)
    const zwConfig = [
      token.feeConfig.verifier || token.verifier,
      token.feeConfig.feeCollector,
      token.feeConfig.feeDenominator,
      token.feeConfig.depositFee,
      token.feeConfig.remintFee,
      token.feeConfig.withdrawFee,
      token.feeConfig.minDepositFee,
      token.feeConfig.minWithdrawFee,
      token.feeConfig.minRemintFee,
    ];

    switch (type) {
      case "ZWETH":
        contractName = "ZWETH";
        constructorArgs = [token.name, token.symbol, zwConfig];
        break;

      case "ZWERC20":
        contractName = "ZWERC20";
        // Get decimals from underlying token
        const underlying = await ethers.getContractAt(
          "IERC20Metadata",
          token.underlying
        );
        const decimals = await underlying.decimals();
        constructorArgs = [
          token.name,
          token.symbol,
          decimals,
          token.underlying,
          zwConfig,
        ];
        break;

      case "ZWERC721":
        contractName = "ZWERC721";
        constructorArgs = [
          token.name,
          token.symbol,
          token.underlying,
          zwConfig,
        ];
        break;

      case "ZWERC1155":
        contractName = "ZWERC1155";
        constructorArgs = [
          token.name,
          token.symbol,
          token.uri || "",
          token.underlying,
          zwConfig,
        ];
        break;

      default:
        console.log(`⚠️  Unknown token type: ${type}`);
        continue;
    }

    // Verify token contract
    await verifyContract(
      `${contractName} (${token.symbol})`,
      token.address,
      constructorArgs,
      libraries
    );
  }

  console.log("\n" + "=".repeat(80));
  console.log("✅ Verification Complete!");
  console.log("=".repeat(80));
}

function getExplorerUrl(network) {
  const explorers = {
    mainnet: "https://etherscan.io",
    sepolia: "https://sepolia.etherscan.io",
    goerli: "https://goerli.etherscan.io",
    arbitrum: "https://arbiscan.io",
    arbitrumSepolia: "https://sepolia.arbiscan.io",
    optimism: "https://optimistic.etherscan.io",
    optimismSepolia: "https://sepolia-optimistic.etherscan.io",
    polygon: "https://polygonscan.com",
    polygonMumbai: "https://mumbai.polygonscan.com",
    bsc: "https://bscscan.com",
    bscTestnet: "https://testnet.bscscan.com",
    hardhat: null,
    localhost: null,
  };
  return explorers[network] || null;
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("\n❌ Verification failed:", error);
      process.exit(1);
    });
}

module.exports = { verifyContracts: main };
