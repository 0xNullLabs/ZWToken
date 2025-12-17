const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

/**
 * Save deployment record to JSON file (incremental, preserves history)
 */
function saveDeploymentRecord(deploymentInfo) {
  const deploymentsDir = path.join(__dirname, "..", "deployments");

  // Ensure deployments directory exists
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  // Generate filename: deployment-{network}-{timestamp}.json
  const timestamp = Date.now();
  const filename = `deployment-${deploymentInfo.network}-${timestamp}.json`;
  const filepath = path.join(deploymentsDir, filename);

  // Save deployment info
  fs.writeFileSync(filepath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\n📝 Deployment info saved: deployments/${filename}`);

  // Also save a latest.json pointing to the latest deployment
  const latestFilepath = path.join(
    deploymentsDir,
    `latest-${deploymentInfo.network}.json`
  );
  fs.writeFileSync(latestFilepath, JSON.stringify(deploymentInfo, null, 2));
  console.log(
    `📝 Latest deployment info: deployments/latest-${deploymentInfo.network}.json`
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
    hardhat: null, // Local network has no explorer
    localhost: null,
  };
  return explorers[network] || null;
}

/**
 * Update README.md deployment records (incremental, appends new records)
 */
function updateReadmeDeployment(deploymentInfo) {
  const readmePath = path.join(__dirname, "..", "README.md");
  let readme = fs.readFileSync(readmePath, "utf-8");

  // Generate deployment record Markdown content
  const deploymentDate = new Date(deploymentInfo.timestamp).toLocaleString(
    "en-US",
    {
      timeZone: "UTC",
    }
  );

  const explorerBaseUrl = getExplorerUrl(deploymentInfo.network);

  // Generate different link formats based on whether explorer exists
  const formatAddress = (address, label) => {
    if (explorerBaseUrl) {
      return `- ${label}: [\`${address}\`](${explorerBaseUrl}/address/${address})`;
    } else {
      return `- ${label}: \`${address}\``;
    }
  };

  const newDeploymentSection = `
### ${
    deploymentInfo.network.charAt(0).toUpperCase() +
    deploymentInfo.network.slice(1)
  } - ${deploymentDate}

**Contract Addresses:**
${formatAddress(deploymentInfo.addresses.poseidonT3, "PoseidonT3")}
${formatAddress(deploymentInfo.addresses.verifier, "Verifier")}
${formatAddress(deploymentInfo.addresses.zwToken, "ZWERC20")}
${formatAddress(
  deploymentInfo.addresses.underlying,
  `Underlying Token (${deploymentInfo.tokenInfo.underlyingSymbol})`
)}

**Token Info:**
- Name: ${deploymentInfo.tokenInfo.name}
- Symbol: ${deploymentInfo.tokenInfo.symbol}
- Decimals: ${deploymentInfo.tokenInfo.decimals}

**Fee Configuration:**
- Fee Collector: \`${deploymentInfo.feeConfig.feeCollector}\`
- Fee Denominator: ${deploymentInfo.feeConfig.feeDenominator}
- Deposit Fee: ${deploymentInfo.feeConfig.depositFee} (${(
    (Number(deploymentInfo.feeConfig.depositFee) * 100) /
    Number(deploymentInfo.feeConfig.feeDenominator)
  ).toFixed(2)}%)
- Remint Fee: ${deploymentInfo.feeConfig.remintFee} (${(
    (Number(deploymentInfo.feeConfig.remintFee) * 100) /
    Number(deploymentInfo.feeConfig.feeDenominator)
  ).toFixed(2)}%)
- Withdraw Fee: ${deploymentInfo.feeConfig.withdrawFee} (${(
    (Number(deploymentInfo.feeConfig.withdrawFee) * 100) /
    Number(deploymentInfo.feeConfig.feeDenominator)
  ).toFixed(2)}%)

**Deployer:** \`${deploymentInfo.deployer}\`
`;

  // Find or create "Deployment Records" section
  const deploymentSectionRegex =
    /## 📦 Deployment Records[\s\S]*?(?=\n## |\n---\n|$)/;

  if (readme.match(deploymentSectionRegex)) {
    // If "Deployment Records" section exists, append new record after it
    readme = readme.replace(
      deploymentSectionRegex,
      (match) => match + "\n" + newDeploymentSection
    );
  } else {
    // If "Deployment Records" section doesn't exist, add at end of file
    const deploymentChapter = `\n---\n\n## 📦 Deployment Records\n${newDeploymentSection}`;
    readme = readme.trimEnd() + "\n" + deploymentChapter + "\n";
  }

  fs.writeFileSync(readmePath, readme);
  console.log(`📝 README.md deployment records updated`);
}

/**
 * ZWERC20 Production Deployment Script
 *
 * Deployment order:
 * 1. PoseidonT3 library (ZK-friendly hash function)
 * 2. Use existing underlying ERC20 token
 * 3. Groth16Verifier (ZK proof verifier)
 * 4. ZWERC20 (main contract, linked with PoseidonT3)
 *
 * Required environment variables:
 * - UNDERLYING_TOKEN_ADDRESS: Underlying ERC20 token address (required)
 * - PRIVATE_KEY: Deployer account private key (required)
 * - SEPOLIA_RPC_URL (or other network): RPC URL (required)
 *
 * Optional environment variables (fee configuration):
 * - FEE_COLLECTOR: Fee collector address (default: deployer.address)
 * - FEE_DENOMINATOR: Fee denominator, 10000 = 100% (default: 10000, provides 0.01% precision)
 * - DEPOSIT_FEE: Deposit fee rate in basis points (default: 0)
 * - REMINT_FEE: Remint fee rate in basis points (default: 0)
 * - WITHDRAW_FEE: Withdraw fee rate in basis points (default: 0)
 *
 * Optional environment variables (Etherscan verification):
 * - ETHERSCAN_API_KEY: Etherscan API key for contract verification (optional)
 *   If set, contracts will be automatically verified after deployment
 */
async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🚀 Starting ZWERC20 Contract Deployment");
  console.log("=".repeat(80));

  const [deployer] = await ethers.getSigners();
  console.log("\n📍 Deployer Account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 Account Balance:", ethers.formatEther(balance), "ETH");

  // ========== 1. Deploy PoseidonT3 Library ==========
  console.log("\n" + "─".repeat(80));
  console.log("📦 Step 1/4: Deploying PoseidonT3 Library");
  console.log("─".repeat(80));

  const PoseidonT3 = await ethers.getContractFactory(
    "poseidon-solidity/PoseidonT3.sol:PoseidonT3"
  );
  const poseidonT3 = await PoseidonT3.deploy();
  await poseidonT3.waitForDeployment();
  const poseidonT3Address = await poseidonT3.getAddress();

  console.log("✅ PoseidonT3 deployed to:", poseidonT3Address);

  // ========== 2. Configure Underlying ERC20 Token ==========
  console.log("\n" + "─".repeat(80));
  console.log("📦 Step 2/4: Configuring Underlying ERC20 Token");
  console.log("─".repeat(80));

  const underlyingAddress = process.env.UNDERLYING_TOKEN_ADDRESS;

  if (!underlyingAddress) {
    console.error("❌ Underlying token address not configured!");
    console.error(
      "Please set environment variable: export UNDERLYING_TOKEN_ADDRESS=0x..."
    );
    throw new Error(
      "UNDERLYING_TOKEN_ADDRESS environment variable is required"
    );
  }

  // Validate address format
  if (!ethers.isAddress(underlyingAddress)) {
    throw new Error(
      "UNDERLYING_TOKEN_ADDRESS must be a valid Ethereum address"
    );
  }

  // Verify contract exists
  const code = await ethers.provider.getCode(underlyingAddress);
  if (code === "0x") {
    throw new Error("No contract found at UNDERLYING_TOKEN_ADDRESS");
  }

  console.log("✅ Using underlying token:", underlyingAddress);

  // Read token info (must succeed)
  const underlying = await ethers.getContractAt(
    "IERC20Metadata",
    underlyingAddress
  );
  const underlyingName = await underlying.name();
  const underlyingSymbol = await underlying.symbol();

  console.log("   Name:", underlyingName);
  console.log("   Symbol:", underlyingSymbol);

  // ========== 3. Deploy Groth16Verifier ==========
  console.log("\n" + "─".repeat(80));
  console.log("📦 Step 3/4: Deploying Groth16Verifier");
  console.log("─".repeat(80));

  const Groth16Verifier = await ethers.getContractFactory("Groth16Verifier");
  const verifier = await Groth16Verifier.deploy();
  await verifier.waitForDeployment();
  const verifierAddress = await verifier.getAddress();

  console.log("✅ Groth16Verifier deployed to:", verifierAddress);
  console.log("   Type: Real ZK Proof Verifier");

  // ========== 4. Deploy ZWERC20 ==========
  console.log("\n" + "─".repeat(80));
  console.log("📦 Step 4/4: Deploying ZWERC20 (Main Contract)");
  console.log("─".repeat(80));

  const ZWERC20 = await ethers.getContractFactory("ZWERC20", {
    libraries: {
      PoseidonT3: poseidonT3Address,
    },
  });

  const zwTokenName = "Zero Knowledge Wrapper " + underlyingName;
  const zwTokenSymbol = "ZW" + underlyingSymbol;
  const underlyingDecimals = await underlying.decimals();

  // Fee configuration (can be set via environment variables, defaults to 0)
  const feeCollector = process.env.FEE_COLLECTOR || deployer.address;
  const feeDenominator = process.env.FEE_DENOMINATOR || 10000; // 10000 = 100%, 0.01% precision
  const depositFee = process.env.DEPOSIT_FEE || 0; // 0 = 0%
  const remintFee = process.env.REMINT_FEE || 0; // 0 = 0%
  const withdrawFee = process.env.WITHDRAW_FEE || 0; // 0 = 0%

  const zwToken = await ZWERC20.deploy(
    zwTokenName,
    zwTokenSymbol,
    underlyingDecimals,
    underlyingAddress,
    verifierAddress,
    feeCollector, // feeCollector
    feeDenominator, // feeDenominator (10000 = 100%)
    depositFee, // depositFee (0 = 0%)
    remintFee, // remintFee (0 = 0%)
    withdrawFee // withdrawFee (0 = 0%)
  );
  await zwToken.waitForDeployment();
  const zwTokenAddress = await zwToken.getAddress();

  console.log("✅ ZWERC20 deployed to:", zwTokenAddress);
  console.log("   Name:", zwTokenName);
  console.log("   Symbol:", zwTokenSymbol);
  console.log("   Decimals:", underlyingDecimals);
  console.log("   Underlying Token:", underlyingAddress);
  console.log("   Verifier:", verifierAddress);
  console.log("   Fee Collector:", feeCollector);
  console.log(
    "   Fee Denominator:",
    feeDenominator,
    "(",
    (100 / feeDenominator) * 100,
    "% precision)"
  );
  console.log(
    "   Deposit Fee:",
    depositFee,
    "bp (",
    (depositFee * 100) / feeDenominator,
    "%)"
  );
  console.log(
    "   Remint Fee:",
    remintFee,
    "bp (",
    (remintFee * 100) / feeDenominator,
    "%)"
  );
  console.log(
    "   Withdraw Fee:",
    withdrawFee,
    "bp (",
    (withdrawFee * 100) / feeDenominator,
    "%)"
  );

  // ========== Deployment Summary ==========
  console.log("\n" + "=".repeat(80));
  console.log("🎉 Deployment Complete!");
  console.log("=".repeat(80));

  console.log("\n📋 Contract Address Summary:");
  console.log("─".repeat(80));
  console.log("PoseidonT3:        ", poseidonT3Address);
  console.log("Underlying Token:  ", underlyingAddress);
  console.log("Verifier:          ", verifierAddress);
  console.log("ZWERC20:           ", zwTokenAddress);
  console.log("─".repeat(80));

  // ========== Save Deployment Record ==========
  const deploymentInfo = {
    network: hre.network.name,
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    addresses: {
      poseidonT3: poseidonT3Address,
      underlying: underlyingAddress,
      verifier: verifierAddress,
      zwToken: zwTokenAddress,
    },
    tokenInfo: {
      name: zwTokenName,
      symbol: zwTokenSymbol,
      decimals: underlyingDecimals.toString(),
      underlyingName: underlyingName,
      underlyingSymbol: underlyingSymbol,
    },
    feeConfig: {
      feeCollector: feeCollector,
      feeDenominator: feeDenominator.toString(),
      depositFee: depositFee.toString(),
      remintFee: remintFee.toString(),
      withdrawFee: withdrawFee.toString(),
    },
  };

  // Save deployment info to JSON file
  saveDeploymentRecord(deploymentInfo);

  // Update README.md deployment records
  updateReadmeDeployment(deploymentInfo);

  console.log(
    "\n✅ Deployment records saved to deployments/ directory and README.md"
  );

  // ========== Verify Contracts on Etherscan ==========
  const explorerBaseUrl = getExplorerUrl(hre.network.name);
  const shouldVerify = explorerBaseUrl && process.env.ETHERSCAN_API_KEY;

  if (shouldVerify) {
    console.log("\n" + "=".repeat(80));
    console.log("🔍 Verifying Contracts on Etherscan");
    console.log("=".repeat(80));

    // Wait for a few blocks to ensure contracts are indexed
    console.log("\n⏳ Waiting for block confirmations...");
    await new Promise((resolve) => setTimeout(resolve, 20000)); // Wait 20 seconds

    try {
      // 1. Verify PoseidonT3 Library
      console.log("\n" + "─".repeat(80));
      console.log("📦 Verifying PoseidonT3 Library");
      console.log("─".repeat(80));
      try {
        await hre.run("verify:verify", {
          address: poseidonT3Address,
          constructorArguments: [],
        });
        console.log(
          "✅ PoseidonT3 verified:",
          `${explorerBaseUrl}/address/${poseidonT3Address}`
        );
      } catch (error) {
        if (error.message.includes("Already Verified")) {
          console.log("ℹ️  PoseidonT3 already verified");
        } else {
          console.log("⚠️  PoseidonT3 verification failed:", error.message);
        }
      }

      // 2. Verify Groth16Verifier
      console.log("\n" + "─".repeat(80));
      console.log("📦 Verifying Groth16Verifier");
      console.log("─".repeat(80));
      try {
        await hre.run("verify:verify", {
          address: verifierAddress,
          constructorArguments: [],
        });
        console.log(
          "✅ Groth16Verifier verified:",
          `${explorerBaseUrl}/address/${verifierAddress}`
        );
      } catch (error) {
        if (error.message.includes("Already Verified")) {
          console.log("ℹ️  Groth16Verifier already verified");
        } else {
          console.log(
            "⚠️  Groth16Verifier verification failed:",
            error.message
          );
        }
      }

      // 3. Verify ZWERC20 (with library linking)
      console.log("\n" + "─".repeat(80));
      console.log("📦 Verifying ZWERC20 (with library linking)");
      console.log("─".repeat(80));
      try {
        await hre.run("verify:verify", {
          address: zwTokenAddress,
          constructorArguments: [
            zwTokenName,
            zwTokenSymbol,
            underlyingDecimals,
            underlyingAddress,
            verifierAddress,
            feeCollector,
            feeDenominator,
            depositFee,
            remintFee,
            withdrawFee,
          ],
          libraries: {
            PoseidonT3: poseidonT3Address,
          },
        });
        console.log(
          "✅ ZWERC20 verified:",
          `${explorerBaseUrl}/address/${zwTokenAddress}`
        );
      } catch (error) {
        if (error.message.includes("Already Verified")) {
          console.log("ℹ️  ZWERC20 already verified");
        } else {
          console.log("⚠️  ZWERC20 verification failed:", error.message);
          console.log("   You can verify manually with:");
          console.log(
            `   npx hardhat verify --network ${hre.network.name} ${zwTokenAddress} "${zwTokenName}" "${zwTokenSymbol}" ${underlyingDecimals} ${underlyingAddress} ${verifierAddress} ${feeCollector} ${feeDenominator} ${depositFee} ${remintFee} ${withdrawFee} --libraries PoseidonT3:${poseidonT3Address}`
          );
        }
      }

      console.log("\n" + "=".repeat(80));
      console.log("✅ Contract Verification Complete!");
      console.log("=".repeat(80));
    } catch (error) {
      console.log(
        "\n⚠️  Verification process encountered an error:",
        error.message
      );
      console.log("   You can verify contracts manually using:");
      console.log(
        `   npx hardhat verify --network ${hre.network.name} <CONTRACT_ADDRESS> [CONSTRUCTOR_ARGS]`
      );
    }
  } else {
    if (!explorerBaseUrl) {
      console.log(
        "\nℹ️  Skipping verification: No explorer for network",
        hre.network.name
      );
    } else if (!process.env.ETHERSCAN_API_KEY) {
      console.log("\nℹ️  Skipping verification: ETHERSCAN_API_KEY not set");
      console.log(
        "   Set ETHERSCAN_API_KEY in .env to enable automatic verification"
      );
    }
  }

  // Return deployed contract addresses for testing
  return {
    poseidonT3: poseidonT3Address,
    underlying: underlyingAddress,
    verifier: verifierAddress,
    zwToken: zwTokenAddress,
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
