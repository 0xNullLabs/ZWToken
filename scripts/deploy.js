const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

/**
 * ZWToken Multi-Contract Deployment Script
 *
 * Supports deploying multiple ZWToken contracts from a JSON configuration file.
 * Each token can have its own verifier and fee configuration.
 * Deployed addresses are written back to the config file for reuse.
 *
 * Environment Variables (sensitive data only):
 * - PRIVATE_KEY: Deployer account private key (required)
 * - *_RPC_URL: Network RPC URL (required, e.g., SEPOLIA_RPC_URL)
 * - ETHERSCAN_API_KEY: For contract verification (optional)
 *
 * Configuration File:
 * - DEPLOY_CONFIG: Path to JSON config file (default: deploy.config.json)
 *
 * Usage:
 *   npx hardhat run scripts/deploy.js --network sepolia
 *   DEPLOY_CONFIG=./my-config.json npx hardhat run scripts/deploy.js --network sepolia
 */

// ========== Utility Functions ==========

/**
 * Load deployment configuration from JSON file
 */
function loadConfig() {
  const configPath =
    process.env.DEPLOY_CONFIG ||
    path.join(__dirname, "..", "deploy.config.json");

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Configuration file not found: ${configPath}\n` +
        `Create a deploy.config.json file or set DEPLOY_CONFIG env variable.`
    );
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  config._configPath = configPath; // Store path for write-back

  if (
    !config.tokens ||
    !Array.isArray(config.tokens) ||
    config.tokens.length === 0
  ) {
    throw new Error("Configuration must contain a non-empty 'tokens' array");
  }

  return config;
}

/**
 * Save updated configuration back to JSON file
 */
function saveConfig(config) {
  const configPath = config._configPath;
  const configToSave = { ...config };
  delete configToSave._configPath; // Don't save internal field

  fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 2) + "\n");
  console.log(`\n📝 Configuration updated: ${configPath}`);
}

/**
 * Save deployment record to JSON file
 */
function saveDeploymentRecord(deploymentInfo) {
  const deploymentsDir = path.join(__dirname, "..", "deployments");

  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const timestamp = Date.now();
  const filename = `deployment-${deploymentInfo.network}-${timestamp}.json`;
  const filepath = path.join(deploymentsDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`📝 Deployment record saved: deployments/${filename}`);

  const latestFilepath = path.join(
    deploymentsDir,
    `latest-${deploymentInfo.network}.json`
  );
  fs.writeFileSync(latestFilepath, JSON.stringify(deploymentInfo, null, 2));
  console.log(
    `📝 Latest deployment: deployments/latest-${deploymentInfo.network}.json`
  );
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
 * Build ZWConfig struct for contract deployment
 */
function buildZWConfig(verifierAddress, tokenConfig, deployer) {
  const feeConfig = tokenConfig.feeConfig || {};

  return {
    verifier: verifierAddress,
    feeCollector: feeConfig.feeCollector || deployer.address,
    feeDenominator: feeConfig.feeDenominator || 10000,
    depositFee: feeConfig.depositFee || 0,
    remintFee: feeConfig.remintFee || 0,
    withdrawFee: feeConfig.withdrawFee || 0,
    minDepositFee: feeConfig.minDepositFee || 0,
    minWithdrawFee: feeConfig.minWithdrawFee || 0,
    minRemintFee: feeConfig.minRemintFee || 0,
  };
}

// ========== Deployment Functions ==========

/**
 * Deploy PoseidonT3 library (shared across all tokens)
 */
async function deployPoseidonT3(existingAddress) {
  if (existingAddress) {
    if (!ethers.isAddress(existingAddress)) {
      throw new Error("poseidonT3 must be a valid Ethereum address");
    }
    const code = await ethers.provider.getCode(existingAddress);
    if (code === "0x") {
      throw new Error("No contract found at poseidonT3 address");
    }
    console.log("✅ Using existing PoseidonT3:", existingAddress);
    return { address: existingAddress, deployed: false };
  }

  console.log("🔧 Deploying PoseidonT3 Library...");
  const PoseidonT3 = await ethers.getContractFactory(
    "poseidon-solidity/PoseidonT3.sol:PoseidonT3"
  );
  const poseidonT3 = await PoseidonT3.deploy();
  await poseidonT3.waitForDeployment();
  const address = await poseidonT3.getAddress();
  console.log("✅ PoseidonT3 deployed to:", address);
  return { address, deployed: true };
}

/**
 * Deploy Groth16Verifier
 */
async function deployVerifier(existingAddress) {
  if (existingAddress) {
    if (!ethers.isAddress(existingAddress)) {
      throw new Error("verifier must be a valid Ethereum address");
    }
    const code = await ethers.provider.getCode(existingAddress);
    if (code === "0x") {
      throw new Error("No contract found at verifier address");
    }
    console.log("   ✅ Using existing Verifier:", existingAddress);
    return { address: existingAddress, deployed: false };
  }

  console.log("   🔧 Deploying Groth16Verifier...");
  const Groth16Verifier = await ethers.getContractFactory("Groth16Verifier");
  const verifier = await Groth16Verifier.deploy();
  await verifier.waitForDeployment();
  const address = await verifier.getAddress();
  console.log("   ✅ Groth16Verifier deployed to:", address);
  return { address, deployed: true };
}

/**
 * Deploy ZWERC20
 */
async function deployZWERC20(poseidonT3Address, tokenConfig, zwConfig) {
  const underlyingAddress = tokenConfig.underlying;

  if (!underlyingAddress) {
    throw new Error("ZWERC20 requires 'underlying' address");
  }

  if (!ethers.isAddress(underlyingAddress)) {
    throw new Error("ZWERC20 underlying must be a valid Ethereum address");
  }

  const code = await ethers.provider.getCode(underlyingAddress);
  if (code === "0x") {
    throw new Error(
      `No contract found at ZWERC20 underlying: ${underlyingAddress}`
    );
  }

  const underlying = await ethers.getContractAt(
    "IERC20Metadata",
    underlyingAddress
  );
  const underlyingName = await underlying.name();
  const underlyingSymbol = await underlying.symbol();
  const underlyingDecimals = await underlying.decimals();

  console.log("   Underlying:", underlyingAddress);
  console.log("   └─ Name:", underlyingName, "| Symbol:", underlyingSymbol);

  const ZWERC20 = await ethers.getContractFactory("ZWERC20", {
    libraries: { PoseidonT3: poseidonT3Address },
  });

  const zwTokenName =
    tokenConfig.name || "Zero Knowledge Wrapper " + underlyingName;
  const zwTokenSymbol = tokenConfig.symbol || "ZW" + underlyingSymbol;

  const zwToken = await ZWERC20.deploy(
    zwTokenName,
    zwTokenSymbol,
    underlyingDecimals,
    underlyingAddress,
    zwConfig
  );
  await zwToken.waitForDeployment();
  const zwTokenAddress = await zwToken.getAddress();

  console.log("   ✅ ZWERC20 deployed:", zwTokenAddress);

  return {
    address: zwTokenAddress,
    name: zwTokenName,
    symbol: zwTokenSymbol,
    decimals: underlyingDecimals.toString(),
    underlyingName,
    underlyingSymbol,
  };
}

/**
 * Deploy ZWERC721
 */
async function deployZWERC721(poseidonT3Address, tokenConfig, zwConfig) {
  const underlyingAddress = tokenConfig.underlying;

  if (!underlyingAddress) {
    throw new Error("ZWERC721 requires 'underlying' address");
  }

  if (!ethers.isAddress(underlyingAddress)) {
    throw new Error("ZWERC721 underlying must be a valid Ethereum address");
  }

  const code = await ethers.provider.getCode(underlyingAddress);
  if (code === "0x") {
    throw new Error(
      `No contract found at ZWERC721 underlying: ${underlyingAddress}`
    );
  }

  let underlyingName = `ERC721#${`${underlyingAddress}`}`;
  let underlyingSymbol = `ERC721#${`${underlyingAddress}`}`;
  try {
    const underlying = await ethers.getContractAt(
      "IERC721Metadata",
      underlyingAddress
    );
    underlyingName = await underlying.name();
    underlyingSymbol = await underlying.symbol();
  } catch (e) {
    console.log("   ⚠️ Could not read underlying metadata");
  }

  console.log("   Underlying:", underlyingAddress);
  console.log("   └─ Name:", underlyingName, "| Symbol:", underlyingSymbol);

  const ZWERC721 = await ethers.getContractFactory("ZWERC721", {
    libraries: { PoseidonT3: poseidonT3Address },
  });

  // Always use underlying name/symbol to generate ZW token name/symbol
  const zwTokenName = tokenConfig.name || "ZK Wrapper " + underlyingName;
  const zwTokenSymbol = tokenConfig.symbol || "ZW" + underlyingSymbol;

  const zwToken = await ZWERC721.deploy(
    zwTokenName,
    zwTokenSymbol,
    underlyingAddress,
    zwConfig
  );
  await zwToken.waitForDeployment();
  const zwTokenAddress = await zwToken.getAddress();

  console.log("   ✅ ZWERC721 deployed:", zwTokenAddress);

  return {
    address: zwTokenAddress,
    name: zwTokenName,
    symbol: zwTokenSymbol,
    underlyingName,
    underlyingSymbol,
  };
}

/**
 * Deploy ZWERC1155
 */
async function deployZWERC1155(poseidonT3Address, tokenConfig, zwConfig) {
  const underlyingAddress = tokenConfig.underlying;

  if (!underlyingAddress) {
    throw new Error("ZWERC1155 requires 'underlying' address");
  }

  if (!ethers.isAddress(underlyingAddress)) {
    throw new Error("ZWERC1155 underlying must be a valid Ethereum address");
  }

  const code = await ethers.provider.getCode(underlyingAddress);
  if (code === "0x") {
    throw new Error(
      `No contract found at ZWERC1155 underlying: ${underlyingAddress}`
    );
  }

  // Try to get name and symbol from underlying (ERC1155 doesn't have standard name/symbol)
  let underlyingName = `ERC1155#${`${underlyingAddress}`}`;
  let underlyingSymbol = `ERC1155#${`${underlyingAddress}`}`;
  try {
    // Try to call name() and symbol() if they exist (using generic contract interface)
    const underlyingContract = await ethers.getContractAt(
      [
        "function name() external view returns (string memory)",
        "function symbol() external view returns (string memory)",
      ],
      underlyingAddress
    );
    try {
      underlyingName = await underlyingContract.name();
    } catch (e) {
      // name() not available, use default
    }
    try {
      underlyingSymbol = await underlyingContract.symbol();
    } catch (e) {
      // symbol() not available, use default
    }
  } catch (e) {
    console.log("   ⚠️ Could not read underlying name/symbol");
  }

  console.log("   Underlying:", underlyingAddress);
  console.log("   └─ Name:", underlyingName, "| Symbol:", underlyingSymbol);

  const ZWERC1155 = await ethers.getContractFactory("ZWERC1155", {
    libraries: { PoseidonT3: poseidonT3Address },
  });

  // Always use underlying name/symbol to generate ZW token name/symbol
  const zwTokenName = tokenConfig.name || "ZK Wrapper " + underlyingName;
  const zwTokenSymbol = tokenConfig.symbol || "ZW" + underlyingSymbol;

  const zwToken = await ZWERC1155.deploy(
    zwTokenName,
    zwTokenSymbol,
    underlyingAddress,
    zwConfig
  );
  await zwToken.waitForDeployment();
  const zwTokenAddress = await zwToken.getAddress();

  console.log("   ✅ ZWERC1155 deployed:", zwTokenAddress);

  return {
    address: zwTokenAddress,
    name: zwTokenName,
    symbol: zwTokenSymbol,
  };
}

/**
 * Deploy ZWETH
 */
async function deployZWETH(poseidonT3Address, tokenConfig, zwConfig) {
  const ZWETH = await ethers.getContractFactory("ZWETH", {
    libraries: { PoseidonT3: poseidonT3Address },
  });

  const zwTokenName = tokenConfig.name || "ZK Wrapper ETH";
  const zwTokenSymbol = tokenConfig.symbol || "ZWETH";

  const zwToken = await ZWETH.deploy(zwTokenName, zwTokenSymbol, zwConfig);
  await zwToken.waitForDeployment();
  const zwTokenAddress = await zwToken.getAddress();

  console.log("   ✅ ZWETH deployed:", zwTokenAddress);

  return {
    address: zwTokenAddress,
    name: zwTokenName,
    symbol: zwTokenSymbol,
  };
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
  console.log("   └─ No restrictions - unlimited minting");

  return {
    address: faucetAddress,
    name,
    symbol,
  };
}

/**
 * Deploy ERC1155Faucet
 */
async function deployERC1155Faucet(faucetConfig) {
  const ERC1155Faucet = await ethers.getContractFactory("ERC1155Faucet");

  const uri = faucetConfig.uri || "https://api.example.com/metadata/{id}.json";
  const maxAmountPerToken = faucetConfig.maxAmountPerToken || 100;
  const maxTokensPerAddress = faucetConfig.maxTokensPerAddress || 10;
  const cooldownPeriod = faucetConfig.cooldownPeriod || 3600; // 1 hour default

  const faucet = await ERC1155Faucet.deploy(
    uri,
    maxAmountPerToken,
    maxTokensPerAddress,
    cooldownPeriod
  );
  await faucet.waitForDeployment();
  const faucetAddress = await faucet.getAddress();

  console.log("   ✅ ERC1155Faucet deployed:", faucetAddress);
  console.log("   └─ URI:", uri);
  console.log("   └─ Max amount per token:", maxAmountPerToken);
  console.log("   └─ Max tokens per address:", maxTokensPerAddress);
  console.log("   └─ Cooldown period:", cooldownPeriod, "seconds");

  return {
    address: faucetAddress,
    uri,
    maxAmountPerToken,
    maxTokensPerAddress,
    cooldownPeriod,
  };
}

/**
 * Deploy a single token
 */
async function deployToken(tokenConfig, poseidonT3Address, deployer, index) {
  const type = tokenConfig.type?.toUpperCase();
  const label = tokenConfig.symbol || tokenConfig.name || type;

  console.log(`\n[${index}] ${type} (${label})`);
  console.log("─".repeat(60));

  // Check if already deployed
  if (tokenConfig.address) {
    const code = await ethers.provider.getCode(tokenConfig.address);
    if (code !== "0x") {
      const name = tokenConfig.name || "N/A";
      const symbol = tokenConfig.symbol || "N/A";
      console.log("   ⏭️  Already deployed:", tokenConfig.address);
      console.log("   └─ Name:", name, "| Symbol:", symbol);
      return {
        skipped: true,
        address: tokenConfig.address,
        name: tokenConfig.name,
        symbol: tokenConfig.symbol,
      };
    }
    console.log(
      "   ⚠️  Address in config but no contract found, redeploying..."
    );
  }

  // Deploy or use existing verifier
  const verifierResult = await deployVerifier(tokenConfig.verifier);
  const verifierAddress = verifierResult.address;

  // Build ZWConfig
  const zwConfig = buildZWConfig(verifierAddress, tokenConfig, deployer);

  // Deploy token based on type
  let result;
  switch (type) {
    case "ZWERC20":
      result = await deployZWERC20(poseidonT3Address, tokenConfig, zwConfig);
      break;
    case "ZWERC721":
      result = await deployZWERC721(poseidonT3Address, tokenConfig, zwConfig);
      break;
    case "ZWERC1155":
      result = await deployZWERC1155(poseidonT3Address, tokenConfig, zwConfig);
      break;
    case "ZWETH":
      result = await deployZWETH(poseidonT3Address, tokenConfig, zwConfig);
      break;
    default:
      throw new Error(`Unknown token type: ${tokenConfig.type}`);
  }

  return {
    skipped: false,
    ...result,
    type,
    verifier: verifierAddress,
    verifierDeployed: verifierResult.deployed,
    feeConfig: zwConfig,
  };
}

/**
 * Verify contracts on Etherscan
 */
async function verifyContracts(toVerify, poseidonT3Address) {
  const explorerBaseUrl = getExplorerUrl(hre.network.name);
  if (!explorerBaseUrl || !process.env.ETHERSCAN_API_KEY) {
    if (!explorerBaseUrl) {
      console.log(
        "\nℹ️  Skipping verification: No explorer for network",
        hre.network.name
      );
    } else {
      console.log("\nℹ️  Skipping verification: ETHERSCAN_API_KEY not set");
    }
    return;
  }

  console.log("\n" + "=".repeat(80));
  console.log("🔍 Verifying Contracts on Etherscan");
  console.log("=".repeat(80));

  console.log("\n⏳ Waiting for block confirmations...");
  await new Promise((resolve) => setTimeout(resolve, 20000));

  const verifyContract = async (name, address, constructorArgs, libraries) => {
    console.log(`\n📦 Verifying ${name}...`);
    try {
      await hre.run("verify:verify", {
        address,
        constructorArguments: constructorArgs || [],
        libraries: libraries || {},
      });
      console.log(`✅ ${name} verified: ${explorerBaseUrl}/address/${address}`);
    } catch (error) {
      if (error.message.includes("Already Verified")) {
        console.log(`ℹ️  ${name} already verified`);
      } else {
        console.log(`⚠️  ${name} verification failed:`, error.message);
      }
    }
  };

  const libraries = { PoseidonT3: poseidonT3Address };

  for (const item of toVerify) {
    await verifyContract(
      item.name,
      item.address,
      item.constructorArgs,
      libraries
    );
  }

  console.log("\n" + "=".repeat(80));
  console.log("✅ Verification Complete!");
  console.log("=".repeat(80));
}

// ========== Main Deployment Function ==========

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🚀 Starting ZWToken Multi-Contract Deployment");
  console.log("=".repeat(80));

  // Load configuration
  const config = loadConfig();
  console.log(`\n📄 Loaded configuration: ${config._configPath}`);
  console.log(`   ${config.tokens.length} token(s) configured`);

  const [deployer] = await ethers.getSigners();
  console.log("\n📍 Deployer:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 Balance:", ethers.formatEther(balance), "ETH");

  // Deploy PoseidonT3 (shared)
  console.log("\n" + "─".repeat(80));
  console.log("📦 Shared Infrastructure");
  console.log("─".repeat(80));

  const poseidonResult = await deployPoseidonT3(config.poseidonT3);
  const poseidonT3Address = poseidonResult.address;

  // Update config with PoseidonT3 address
  if (poseidonResult.deployed) {
    config.poseidonT3 = poseidonT3Address;
  }

  // Track what needs verification
  const toVerify = [];

  if (poseidonResult.deployed) {
    toVerify.push({
      name: "PoseidonT3",
      address: poseidonT3Address,
      constructorArgs: [],
    });
  }

  // Track deployed verifiers to avoid re-verification
  const deployedVerifiers = new Set();

  // Deploy each token
  const results = [];

  for (let i = 0; i < config.tokens.length; i++) {
    const tokenConfig = config.tokens[i];

    try {
      const result = await deployToken(
        tokenConfig,
        poseidonT3Address,
        deployer,
        i + 1
      );

      results.push(result);

      // Update config with deployed addresses
      if (!result.skipped) {
        config.tokens[i].address = result.address;
        config.tokens[i].verifier = result.verifier;
        // Write back auto-generated name and symbol
        if (result.name) config.tokens[i].name = result.name;
        if (result.symbol) config.tokens[i].symbol = result.symbol;

        // Add verifier to verification list (only once per address)
        if (
          result.verifierDeployed &&
          !deployedVerifiers.has(result.verifier)
        ) {
          deployedVerifiers.add(result.verifier);
          toVerify.push({
            name: `Groth16Verifier`,
            address: result.verifier,
            constructorArgs: [],
          });
        }

        // Add token to verification list
        const type = tokenConfig.type?.toUpperCase();
        let constructorArgs;

        switch (type) {
          case "ZWERC20": {
            const underlying = await ethers.getContractAt(
              "IERC20Metadata",
              tokenConfig.underlying
            );
            const decimals = await underlying.decimals();
            constructorArgs = [
              result.name,
              result.symbol,
              decimals,
              tokenConfig.underlying,
              result.feeConfig,
            ];
            break;
          }
          case "ZWERC721":
            constructorArgs = [
              result.name,
              result.symbol,
              tokenConfig.underlying,
              result.feeConfig,
            ];
            break;
          case "ZWERC1155":
            constructorArgs = [
              result.name,
              result.symbol,
              tokenConfig.underlying,
              result.feeConfig,
            ];
            break;
          case "ZWETH":
            constructorArgs = [result.name, result.symbol, result.feeConfig];
            break;
        }

        toVerify.push({
          name: `${type} (${result.symbol})`,
          address: result.address,
          constructorArgs,
        });
      }
    } catch (error) {
      console.error(`\n❌ Failed to deploy token ${i + 1}:`, error.message);
      throw error;
    }
  }

  // Deploy faucets if configured
  const faucetResults = [];
  if (
    config.faucets &&
    Array.isArray(config.faucets) &&
    config.faucets.length > 0
  ) {
    console.log("\n" + "─".repeat(80));
    console.log("🚰 Faucet Contracts");
    console.log("─".repeat(80));

    for (let i = 0; i < config.faucets.length; i++) {
      const faucetConfig = config.faucets[i];
      const type = faucetConfig.type?.toUpperCase();
      const label = faucetConfig.name || faucetConfig.symbol || type;

      console.log(`\n[Faucet ${i + 1}] ${type} (${label})`);
      console.log("─".repeat(60));

      // Check if already deployed
      if (faucetConfig.address) {
        const code = await ethers.provider.getCode(faucetConfig.address);
        if (code !== "0x") {
          console.log("   ⏭️  Already deployed:", faucetConfig.address);
          faucetResults.push({
            skipped: true,
            address: faucetConfig.address,
            type,
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
        faucetResults.push(result);

        // Update config with deployed address
        config.faucets[i].address = result.address;
        // Write back auto-generated name and symbol
        if (result.name) config.faucets[i].name = result.name;
        if (result.symbol) config.faucets[i].symbol = result.symbol;

        // Add to verification list
        let constructorArgs;
        if (type === "ERC721FAUCET") {
          constructorArgs = [result.name, result.symbol];
        } else if (type === "ERC1155FAUCET") {
          constructorArgs = [
            result.uri,
            result.maxAmountPerToken,
            result.maxTokensPerAddress,
            result.cooldownPeriod,
          ];
        }

        toVerify.push({
          name: `${type} (${result.name || result.symbol})`,
          address: result.address,
          constructorArgs,
        });
      } catch (error) {
        console.error(`\n❌ Failed to deploy faucet ${i + 1}:`, error.message);
        throw error;
      }
    }
  }

  // Save updated config
  saveConfig(config);

  // Deployment summary
  console.log("\n" + "=".repeat(80));
  console.log("🎉 Deployment Complete!");
  console.log("=".repeat(80));

  console.log("\n📋 Summary:");
  console.log("─".repeat(60));
  console.log("PoseidonT3:".padEnd(15), poseidonT3Address);

  let deployedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < config.tokens.length; i++) {
    const token = config.tokens[i];
    const result = results[i];
    const status = result.skipped ? "(existing)" : "(new)";

    if (result.skipped) {
      skippedCount++;
    } else {
      deployedCount++;
    }

    const name = result.name || token.name || "N/A";
    const symbol = result.symbol || token.symbol || "N/A";

    console.log(`${token.type}:`.padEnd(15), token.address, status);
    console.log("  └─ Name:".padEnd(15), name);
    console.log("  └─ Symbol:".padEnd(15), symbol);
    if (token.underlying) {
      console.log("  └─ Underlying:".padEnd(15), token.underlying);
    }
    console.log("  └─ Verifier:".padEnd(15), token.verifier);
  }

  console.log("─".repeat(60));
  console.log(
    `📊 Tokens - Deployed: ${deployedCount} | Skipped: ${skippedCount}`
  );

  // Display faucet summary
  if (faucetResults.length > 0) {
    console.log("\n🚰 Faucets:");
    console.log("─".repeat(60));
    let faucetDeployedCount = 0;
    let faucetSkippedCount = 0;

    for (let i = 0; i < faucetResults.length; i++) {
      const faucet = config.faucets[i];
      const result = faucetResults[i];
      const status = result.skipped ? "(existing)" : "(new)";

      if (result.skipped) {
        faucetSkippedCount++;
      } else {
        faucetDeployedCount++;
      }

      console.log(`${faucet.type}:`.padEnd(15), faucet.address, status);
      if (result.name) {
        console.log("  └─ Name:".padEnd(15), result.name);
      }
      if (result.symbol) {
        console.log("  └─ Symbol:".padEnd(15), result.symbol);
      }
      if (result.uri) {
        console.log("  └─ URI:".padEnd(15), result.uri);
      }
    }

    console.log("─".repeat(60));
    console.log(
      `📊 Faucets - Deployed: ${faucetDeployedCount} | Skipped: ${faucetSkippedCount}`
    );
  }

  // Save deployment record
  const deploymentInfo = {
    network: hre.network.name,
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    poseidonT3: poseidonT3Address,
    tokens: config.tokens.map((t, i) => ({
      type: t.type,
      address: t.address,
      verifier: t.verifier,
      underlying: t.underlying,
      name: results[i].name || t.name,
      symbol: results[i].symbol || t.symbol,
      skipped: results[i].skipped,
    })),
    faucets: config.faucets
      ? config.faucets.map((f, i) => ({
          type: f.type,
          address: f.address,
          name: faucetResults[i]?.name || f.name,
          symbol: faucetResults[i]?.symbol || f.symbol,
          skipped: faucetResults[i]?.skipped || false,
        }))
      : [],
  };

  saveDeploymentRecord(deploymentInfo);

  // Verify contracts
  if (toVerify.length > 0) {
    await verifyContracts(toVerify, poseidonT3Address);
  }

  return {
    poseidonT3: poseidonT3Address,
    tokens: config.tokens,
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

module.exports = { deployContracts: main };
