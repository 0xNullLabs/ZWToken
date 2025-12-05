const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

/**
 * 保存部署记录到 JSON 文件（递增式，不删除历史记录）
 */
function saveDeploymentRecord(deploymentInfo) {
  const deploymentsDir = path.join(__dirname, "..", "deployments");

  // 确保 deployments 目录存在
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  // 生成文件名：deployment-{network}-{timestamp}.json
  const timestamp = Date.now();
  const filename = `deployment-${deploymentInfo.network}-${timestamp}.json`;
  const filepath = path.join(deploymentsDir, filename);

  // 保存部署信息
  fs.writeFileSync(filepath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\n📝 部署信息已保存: deployments/${filename}`);

  // 同时保存一个 latest.json 指向最新部署
  const latestFilepath = path.join(
    deploymentsDir,
    `latest-${deploymentInfo.network}.json`
  );
  fs.writeFileSync(latestFilepath, JSON.stringify(deploymentInfo, null, 2));
  console.log(
    `📝 最新部署信息: deployments/latest-${deploymentInfo.network}.json`
  );
}

/**
 * 获取区块浏览器 URL
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
    hardhat: null, // 本地网络无浏览器
    localhost: null,
  };
  return explorers[network] || null;
}

/**
 * 更新 README.md 的部署记录（递增式，追加新记录）
 */
function updateReadmeDeployment(deploymentInfo) {
  const readmePath = path.join(__dirname, "..", "README.md");
  let readme = fs.readFileSync(readmePath, "utf-8");

  // 生成部署记录的 Markdown 内容
  const deploymentDate = new Date(deploymentInfo.timestamp).toLocaleString(
    "zh-CN",
    {
      timeZone: "Asia/Shanghai",
    }
  );

  const explorerBaseUrl = getExplorerUrl(deploymentInfo.network);

  // 根据是否有区块浏览器生成不同格式的链接
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

**合约地址:**
${formatAddress(deploymentInfo.addresses.poseidonT3, "PoseidonT3")}
${formatAddress(deploymentInfo.addresses.verifier, "Verifier")}
${formatAddress(deploymentInfo.addresses.zwToken, "ZWERC20")}
${formatAddress(
  deploymentInfo.addresses.underlying,
  `Underlying Token (${deploymentInfo.tokenInfo.underlyingSymbol})`
)}

**代币信息:**
- 名称: ${deploymentInfo.tokenInfo.name}
- 符号: ${deploymentInfo.tokenInfo.symbol}
- 小数位数: ${deploymentInfo.tokenInfo.decimals}

**费用配置:**
- 费用收集器: \`${deploymentInfo.feeConfig.feeCollector}\`
- 费用分母: ${deploymentInfo.feeConfig.feeDenominator}
- 存款费率: ${deploymentInfo.feeConfig.depositFee} (${(
    (Number(deploymentInfo.feeConfig.depositFee) * 100) /
    Number(deploymentInfo.feeConfig.feeDenominator)
  ).toFixed(2)}%)
- Remint 费率: ${deploymentInfo.feeConfig.remintFee} (${(
    (Number(deploymentInfo.feeConfig.remintFee) * 100) /
    Number(deploymentInfo.feeConfig.feeDenominator)
  ).toFixed(2)}%)
- 提款费率: ${deploymentInfo.feeConfig.withdrawFee} (${(
    (Number(deploymentInfo.feeConfig.withdrawFee) * 100) /
    Number(deploymentInfo.feeConfig.feeDenominator)
  ).toFixed(2)}%)

**部署账户:** \`${deploymentInfo.deployer}\`
`;

  // 查找或创建"部署记录"章节
  const deploymentSectionRegex = /## 📦 部署记录[\s\S]*?(?=\n## |\n---\n|$)/;

  if (readme.match(deploymentSectionRegex)) {
    // 如果已存在"部署记录"章节，在其后追加新记录
    readme = readme.replace(
      deploymentSectionRegex,
      (match) => match + "\n" + newDeploymentSection
    );
  } else {
    // 如果不存在"部署记录"章节，在文件末尾添加
    const deploymentChapter = `\n---\n\n## 📦 部署记录\n${newDeploymentSection}`;
    readme = readme.trimEnd() + "\n" + deploymentChapter + "\n";
  }

  fs.writeFileSync(readmePath, readme);
  console.log(`📝 README.md 已更新部署记录`);
}

/**
 * ZWERC20 生产环境部署脚本
 *
 * 部署顺序：
 * 1. PoseidonT3 库（ZK 友好的哈希函数）
 * 2. 使用现有的底层 ERC20 代币
 * 3. Groth16Verifier (ZK proof 验证器)
 * 4. ZWERC20 (主合约，链接 PoseidonT3)
 *
 * 环境变量要求：
 * - UNDERLYING_TOKEN_ADDRESS: 底层 ERC20 代币地址（必需）
 * - PRIVATE_KEY: 部署账户私钥（必需）
 * - SEPOLIA_RPC_URL (或其他网络): RPC URL（必需）
 *
 * 可选环境变量（费用配置）：
 * - FEE_COLLECTOR: 费用收集器地址（默认：deployer.address）
 * - FEE_DENOMINATOR: 费用分母，10000 = 100%（默认：10000，提供 0.01% 精度）
 * - DEPOSIT_FEE: 存款费率，单位 basis points，基于 FEE_DENOMINATOR（默认：0）
 * - REMINT_FEE: Remint 费率，单位 basis points，基于 FEE_DENOMINATOR（默认：0）
 * - WITHDRAW_FEE: 提款费率，单位 basis points，基于 FEE_DENOMINATOR（默认：0）
 */
async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🚀 开始部署 ZWERC20 合约");
  console.log("=".repeat(80));

  const [deployer] = await ethers.getSigners();
  console.log("\n📍 部署账户:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 账户余额:", ethers.formatEther(balance), "ETH");

  // ========== 1. 部署 PoseidonT3 库 ==========
  console.log("\n" + "─".repeat(80));
  console.log("📦 步骤 1/4: 部署 PoseidonT3 库");
  console.log("─".repeat(80));

  const PoseidonT3 = await ethers.getContractFactory(
    "poseidon-solidity/PoseidonT3.sol:PoseidonT3"
  );
  const poseidonT3 = await PoseidonT3.deploy();
  await poseidonT3.waitForDeployment();
  const poseidonT3Address = await poseidonT3.getAddress();

  console.log("✅ PoseidonT3 已部署至:", poseidonT3Address);

  // ========== 2. 配置底层 ERC20 代币 ==========
  console.log("\n" + "─".repeat(80));
  console.log("📦 步骤 2/4: 配置底层 ERC20 代币");
  console.log("─".repeat(80));

  const underlyingAddress = process.env.UNDERLYING_TOKEN_ADDRESS;

  if (!underlyingAddress) {
    console.error("❌ 未配置底层代币地址！");
    console.error("请设置环境变量：export UNDERLYING_TOKEN_ADDRESS=0x...");
    throw new Error("必须配置 UNDERLYING_TOKEN_ADDRESS 环境变量");
  }

  // 验证地址格式
  if (!ethers.isAddress(underlyingAddress)) {
    throw new Error("UNDERLYING_TOKEN_ADDRESS 必须是有效的以太坊地址");
  }

  // 验证合约存在
  const code = await ethers.provider.getCode(underlyingAddress);
  if (code === "0x") {
    throw new Error("UNDERLYING_TOKEN_ADDRESS 地址上没有合约");
  }

  console.log("✅ 使用底层代币:", underlyingAddress);

  // 读取代币信息（必须成功）
  const underlying = await ethers.getContractAt(
    "IERC20Metadata",
    underlyingAddress
  );
  const underlyingName = await underlying.name();
  const underlyingSymbol = await underlying.symbol();

  console.log("   名称:", underlyingName);
  console.log("   符号:", underlyingSymbol);

  // ========== 3. 部署 Groth16Verifier ==========
  console.log("\n" + "─".repeat(80));
  console.log("📦 步骤 3/4: 部署 Groth16Verifier");
  console.log("─".repeat(80));

  const Groth16Verifier = await ethers.getContractFactory("Groth16Verifier");
  const verifier = await Groth16Verifier.deploy();
  await verifier.waitForDeployment();
  const verifierAddress = await verifier.getAddress();

  console.log("✅ Groth16Verifier 已部署至:", verifierAddress);
  console.log("   类型: 真实 ZK Proof 验证器");

  // ========== 4. 部署 ZWERC20 ==========
  console.log("\n" + "─".repeat(80));
  console.log("📦 步骤 4/4: 部署 ZWERC20 (主合约)");
  console.log("─".repeat(80));

  const ZWERC20 = await ethers.getContractFactory("ZWERC20", {
    libraries: {
      PoseidonT3: poseidonT3Address,
    },
  });

  const zwTokenName = "Zero Knowledge Wrapper " + underlyingName;
  const zwTokenSymbol = "ZW" + underlyingSymbol;
  const underlyingDecimals = await underlying.decimals();

  // 费用配置（可通过环境变量设置，默认为 0）
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

  console.log("✅ ZWERC20 已部署至:", zwTokenAddress);
  console.log("   名称:", zwTokenName);
  console.log("   符号:", zwTokenSymbol);
  console.log("   小数位数:", underlyingDecimals);
  console.log("   底层代币:", underlyingAddress);
  console.log("   验证器:", verifierAddress);
  console.log("   费用收集器:", feeCollector);
  console.log(
    "   费用分母:",
    feeDenominator,
    "(",
    (100 / feeDenominator) * 100,
    "% precision)"
  );
  console.log(
    "   存款费率:",
    depositFee,
    "bp (",
    (depositFee * 100) / feeDenominator,
    "%)"
  );
  console.log(
    "   Remint 费率:",
    remintFee,
    "bp (",
    (remintFee * 100) / feeDenominator,
    "%)"
  );
  console.log(
    "   提款费率:",
    withdrawFee,
    "bp (",
    (withdrawFee * 100) / feeDenominator,
    "%)"
  );

  // ========== 部署总结 ==========
  console.log("\n" + "=".repeat(80));
  console.log("🎉 部署完成！");
  console.log("=".repeat(80));

  console.log("\n📋 合约地址汇总：");
  console.log("─".repeat(80));
  console.log("PoseidonT3:        ", poseidonT3Address);
  console.log("Underlying Token:  ", underlyingAddress);
  console.log("Verifier:          ", verifierAddress);
  console.log("ZWERC20:           ", zwTokenAddress);
  console.log("─".repeat(80));

  // ========== 保存部署记录 ==========
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

  // 保存部署信息到 JSON 文件
  saveDeploymentRecord(deploymentInfo);

  // 更新 README.md 的部署记录
  updateReadmeDeployment(deploymentInfo);

  console.log("\n✅ 部署记录已保存到 deployments/ 目录和 README.md");

  // 返回部署的合约地址供测试使用
  return {
    poseidonT3: poseidonT3Address,
    underlying: underlyingAddress,
    verifier: verifierAddress,
    zwToken: zwTokenAddress,
  };
}

// 如果直接运行此脚本
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("\n❌ 部署失败:", error);
      process.exit(1);
    });
}

module.exports = { deployContracts: main };
