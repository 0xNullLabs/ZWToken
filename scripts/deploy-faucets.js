const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

/**
 * Faucet Deployment Script
 *
 * Deploys ERC721Faucet and ERC1155Faucet contracts for testnet usage.
 *
 * Environment Variables:
 * - PRIVATE_KEY: Deployer account private key (required)
 * - *_RPC_URL: Network RPC URL (required, e.g., SEPOLIA_RPC_URL)
 * - ETHERSCAN_API_KEY: For contract verification (optional)
 *
 * Configuration File:
 * - FAUCET_CONFIG: Path to JSON config file (default: faucet.config.json)
 *
 * Usage:
 *   npx hardhat run scripts/deploy-faucets.js --network sepolia
 *   FAUCET_CONFIG=./my-faucet-config.json npx hardhat run scripts/deploy-faucets.js --network sepolia
 */

/**
 * Load faucet configuration from JSON file
 */
function loadFaucetConfig() {
  const configPath =
    process.env.FAUCET_CONFIG ||
    path.join(__dirname, "..", "faucet.config.json");

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Configuration file not found: ${configPath}\n` +
        `Create a faucet.config.json file or set FAUCET_CONFIG env variable.`
    );
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  config._configPath = configPath;

  if (
    !config.faucets ||
    !Array.isArray(config.faucets) ||
    config.faucets.length === 0
  ) {
    throw new Error("Configuration must contain a non-empty 'faucets' array");
  }

  return config;
}

/**
 * Save updated configuration back to JSON file
 */
function saveFaucetConfig(config) {
  const configPath = config._configPath;
  const configToSave = { ...config };
  delete configToSave._configPath;

  fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 2) + "\n");
  console.log(`\n📝 Configuration updated: ${configPath}`);
}

/**
 * Get block explorer URL
 */
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

/**
 * Deploy ERC721Faucet
 */
async function deployERC721Faucet(faucetConfig) {
  const ERC721Faucet = await ethers.getContractFactory("ERC721Faucet");

  const name = faucetConfig.name || "Test ERC721 Faucet";
  const symbol = faucetConfig.symbol || "TEST721";

  const faucet = await ERC721Faucet.deploy(name, symbol);
  await faucet.waitForDeployment();
  const faucetAddress = await faucet.getAddress();

  console.log("   ✅ ERC721Faucet deployed:", faucetAddress);
  console.log("   └─ Name:", name, "| Symbol:", symbol);

  return {
    address: faucetAddress,
    name,
    symbol,
    constructorArgs: [name, symbol],
  };
}

/**
 * Deploy ERC1155Faucet
 */
async function deployERC1155Faucet(faucetConfig) {
  const ERC1155Faucet = await ethers.getContractFactory("ERC1155Faucet");

  const name = faucetConfig.name || "Test ERC1155 Faucet";
  const symbol = faucetConfig.symbol || "TEST1155";

  const faucet = await ERC1155Faucet.deploy(name, symbol);
  await faucet.waitForDeployment();
  const faucetAddress = await faucet.getAddress();

  console.log("   ✅ ERC1155Faucet deployed:", faucetAddress);
  console.log("   └─ Name:", name, "| Symbol:", symbol);

  return {
    address: faucetAddress,
    name,
    symbol,
    constructorArgs: [name, symbol],
  };
}

/**
 * Verify contracts on Etherscan
 */
async function verifyContracts(toVerify) {
  const explorerBaseUrl = getExplorerUrl(hre.network.name);
  if (!explorerBaseUrl) {
    console.log(
      "\nℹ️  Skipping verification: No explorer for network",
      hre.network.name
    );
    return;
  }

  if (!process.env.ETHERSCAN_API_KEY) {
    console.log("\nℹ️  Skipping verification: ETHERSCAN_API_KEY not set");
    return;
  }

  console.log("\n" + "=".repeat(80));
  console.log("🔍 Verifying Contracts on Etherscan");
  console.log("=".repeat(80));

  console.log("\n⏳ Waiting for block confirmations...");
  await new Promise((resolve) => setTimeout(resolve, 20000));

  const verifyContract = async (name, address, constructorArgs) => {
    console.log(`\n📦 Verifying ${name}...`);
    try {
      await hre.run("verify:verify", {
        address,
        constructorArguments: constructorArgs || [],
      });
      console.log(`✅ ${name} verified: ${explorerBaseUrl}/address/${address}`);
      return true;
    } catch (error) {
      if (error.message.includes("Already Verified")) {
        console.log(`ℹ️  ${name} already verified`);
        return true;
      } else {
        console.log(`⚠️  ${name} verification failed:`, error.message);
        return false;
      }
    }
  };

  for (const item of toVerify) {
    await verifyContract(item.name, item.address, item.constructorArgs);
  }

  console.log("\n" + "=".repeat(80));
  console.log("✅ Verification Complete!");
  console.log("=".repeat(80));
}

/**
 * Main deployment function
 */
async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🚰 Starting Faucet Contracts Deployment");
  console.log("=".repeat(80));

  // Load configuration
  const config = loadFaucetConfig();
  console.log(`\n📄 Loaded configuration: ${config._configPath}`);
  console.log(`   ${config.faucets.length} faucet(s) configured`);

  const [deployer] = await ethers.getSigners();
  console.log("\n📍 Deployer:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 Balance:", ethers.formatEther(balance), "ETH");

  // Track what needs verification
  const toVerify = [];
  const results = [];

  // Deploy each faucet
  for (let i = 0; i < config.faucets.length; i++) {
    const faucetConfig = config.faucets[i];
    const type = faucetConfig.type?.toUpperCase();
    const label = faucetConfig.name || faucetConfig.symbol || type;

    console.log(`\n[${i + 1}] ${type} (${label})`);
    console.log("─".repeat(60));

    // Check if already deployed
    if (faucetConfig.address) {
      const code = await ethers.provider.getCode(faucetConfig.address);
      if (code !== "0x") {
        console.log("   ⏭️  Already deployed:", faucetConfig.address);
        results.push({
          skipped: true,
          address: faucetConfig.address,
          type,
          name: faucetConfig.name,
          symbol: faucetConfig.symbol,
        });
        continue;
      }
      console.log(
        "   ⚠️  Address in config but no contract found, redeploying..."
      );
    }

    let result;
    try {
      switch (type) {
        case "ERC721FAUCET":
          result = await deployERC721Faucet(faucetConfig);
          result.type = "ERC721Faucet";
          break;
        case "ERC1155FAUCET":
          result = await deployERC1155Faucet(faucetConfig);
          result.type = "ERC1155Faucet";
          break;
        default:
          throw new Error(`Unknown faucet type: ${faucetConfig.type}`);
      }

      result.skipped = false;
      results.push(result);

      // Update config with deployed address
      config.faucets[i].address = result.address;

      // Add to verification list
      toVerify.push({
        name: `${result.type} (${result.name})`,
        address: result.address,
        constructorArgs: result.constructorArgs,
      });
    } catch (error) {
      console.error(`\n❌ Failed to deploy faucet ${i + 1}:`, error.message);
      throw error;
    }
  }

  // Save updated config
  saveFaucetConfig(config);

  // Deployment summary
  console.log("\n" + "=".repeat(80));
  console.log("🎉 Deployment Complete!");
  console.log("=".repeat(80));

  console.log("\n📋 Summary:");
  console.log("─".repeat(60));

  let deployedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < config.faucets.length; i++) {
    const faucet = config.faucets[i];
    const result = results[i];
    const status = result.skipped ? "(existing)" : "(new)";

    if (result.skipped) {
      skippedCount++;
    } else {
      deployedCount++;
    }

    console.log(`${faucet.type}:`.padEnd(18), faucet.address, status);
    if (result.name) {
      console.log("  └─ Name:".padEnd(18), result.name);
    }
    if (result.symbol) {
      console.log("  └─ Symbol:".padEnd(18), result.symbol);
    }
  }

  console.log("─".repeat(60));
  console.log(`📊 Deployed: ${deployedCount} | Skipped: ${skippedCount}`);

  // Print addresses for easy copying
  console.log("\n📝 Faucet Addresses:");
  console.log("─".repeat(60));
  for (const faucet of config.faucets) {
    console.log(`${faucet.type}:`.padEnd(18), faucet.address);
  }

  // Verify contracts
  if (toVerify.length > 0) {
    await verifyContracts(toVerify);
  }

  return {
    faucets: config.faucets,
  };
}

// If running this script directly
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("\n❌ Deployment failed:", error);
      process.exit(1);
    });
}

module.exports = { deployFaucets: main };
