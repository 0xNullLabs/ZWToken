/**
 * generate_proof.js - 生成真实的 ZK proof
 *
 * 基于当前骨架电路生成证明（使用 placeholder 输入）
 * 未来完整实现 MPT 后需要提供真实的 accountProof 和 storageProof
 */

const snarkjs = require("snarkjs");
const circomlibjs = require("circomlibjs");
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const TWO160 = 1461501637330902918203684832716283019655932542976n; // 2^160
const FIELD_SIZE =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n; // BN254 field modulus
const TWO128 = 340282366920938463463374607431768211456n; // 2^128

/**
 * 将 256 位值拆分为高 128 位和低 128 位
 * @param {BigInt} value - 256 位值
 * @returns {{hi: BigInt, lo: BigInt}}
 */
function split256to128(value) {
  const val = BigInt(value);
  const lo = val & (TWO128 - 1n); // 低 128 位
  const hi = val >> 128n; // 高 128 位
  return { hi, lo };
}

/**
 * 构建电路输入
 */
async function buildCircuitInput(params) {
  const {
    secret,
    magic,
    headerHash,
    blockNumber,
    stateRoot,
    amount,
    chainId,
    contractAddr,
    to,
    balance, // 地址在目标区块的余额
  } = params;

  // 1. 计算 addr20 = low160(Poseidon(MAGIC, secret))
  const poseidon = circomlibjs.poseidon;
  let addrScalar = poseidon([magic, secret]);

  // 确保 addrScalar 在 field 范围内（Poseidon 已经返回 mod FIELD_SIZE 的值，但double-check）
  addrScalar = addrScalar % FIELD_SIZE;

  const addr20 = addrScalar & ((1n << 160n) - 1n);
  const q = (addrScalar - addr20) / TWO160;

  // 2. 计算 nullifier = Poseidon(secret, chainId, contractAddr)
  const nullifier = poseidon([secret, chainId, BigInt(contractAddr)]);

  // 3. 拆分 256 位哈希为 128 位部分（避免超出 BN254 field size）
  const headerHashSplit = split256to128(BigInt(headerHash));
  const stateRootSplit = split256to128(BigInt(stateRoot));

  // 4. 构建完整的电路输入
  const input = {
    // 公共输入
    headerHashHi: headerHashSplit.hi,
    headerHashLo: headerHashSplit.lo,
    stateRootHi: stateRootSplit.hi,
    stateRootLo: stateRootSplit.lo,
    amount: BigInt(amount),
    nullifier: nullifier,
    chainId: BigInt(chainId),
    contractAddr: BigInt(contractAddr),
    to: BigInt(to),

    // 私有输入
    secret: secret,
    addr20: addr20,
    q: q,

    // Placeholder 输入（未来需要真实的 RLP/Keccak/MPT 证明）
    headerHashHiCalc: headerHashSplit.hi, // placeholder: 直接使用 headerHashHi
    headerHashLoCalc: headerHashSplit.lo, // placeholder: 直接使用 headerHashLo
    stateRootHiParsed: stateRootSplit.hi, // placeholder: 直接使用 stateRootHi
    stateRootLoParsed: stateRootSplit.lo, // placeholder: 直接使用 stateRootLo
    storageRootWitness: 0n, // placeholder: 未使用
    balance: BigInt(balance), // placeholder: 直接提供余额
  };

  return input;
}

/**
 * 生成 ZK proof
 */
async function generateProof(circuitInput, wasmPath, zkeyPath) {
  console.log("\n⏳ 正在生成 witness...");
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInput,
    wasmPath,
    zkeyPath
  );

  console.log("✅ Witness 生成完成");
  console.log("⏳ 正在生成 proof...");

  return { proof, publicSignals };
}

/**
 * 验证 proof（本地验证）
 */
async function verifyProof(proof, publicSignals, vkeyPath) {
  const vkey = JSON.parse(fs.readFileSync(vkeyPath, "utf-8"));
  const verified = await snarkjs.groth16.verify(vkey, publicSignals, proof);
  return verified;
}

/**
 * 将 proof 转换为 Solidity 合约调用格式
 */
function formatProofForSolidity(proof) {
  return {
    a: [proof.pi_a[0], proof.pi_a[1]],
    b: [
      [proof.pi_b[0][1], proof.pi_b[0][0]], // 注意：反转顺序
      [proof.pi_b[1][1], proof.pi_b[1][0]],
    ],
    c: [proof.pi_c[0], proof.pi_c[1]],
  };
}

/**
 * 主函数
 */
async function main() {
  const argv = require("minimist")(process.argv.slice(2));

  // 参数解析
  const secret = BigInt(argv.secret || "123456789");
  const magic = BigInt(argv.magic || "42");
  const headerHash = argv.headerHash;
  const blockNumber = argv.blockNumber;
  const stateRoot = argv.stateRoot;
  const amount = argv.amount;
  const chainId = argv.chainId;
  const contractAddr = argv.contractAddr;
  const to = argv.to;
  const balance = argv.balance;

  // 检查必需参数
  if (
    !headerHash ||
    !blockNumber ||
    !stateRoot ||
    !amount ||
    !chainId ||
    !contractAddr ||
    !to ||
    !balance
  ) {
    console.error("❌ 缺少必需参数");
    console.error("用法: node generate_proof.js \\");
    console.error("  --secret <secret> \\");
    console.error("  --magic <magic> \\");
    console.error("  --headerHash <hash> \\");
    console.error("  --blockNumber <number> \\");
    console.error("  --stateRoot <hash> \\");
    console.error("  --amount <amount> \\");
    console.error("  --chainId <chainId> \\");
    console.error("  --contractAddr <address> \\");
    console.error("  --to <address> \\");
    console.error("  --balance <balance>");
    process.exit(1);
  }

  console.log("🔧 参数:");
  console.log("  Secret:", secret.toString());
  console.log("  Magic:", magic.toString());
  console.log("  Block Number:", blockNumber);
  console.log("  Amount:", amount);
  console.log("  Chain ID:", chainId);
  console.log("  Contract:", contractAddr);
  console.log("  To:", to);

  // 构建电路输入
  console.log("\n📝 构建电路输入...");
  const circuitInput = await buildCircuitInput({
    secret,
    magic,
    headerHash,
    blockNumber,
    stateRoot,
    amount,
    chainId,
    contractAddr,
    to,
    balance,
  });

  // 路径配置
  const projectRoot = path.join(__dirname, "..");
  const wasmPath = path.join(
    projectRoot,
    "circuits/out/claim_from_state_root_js/claim_from_state_root.wasm"
  );
  const zkeyPath = path.join(projectRoot, "circuits/out/claim_final.zkey");
  const vkeyPath = path.join(projectRoot, "circuits/out/verification_key.json");

  // 生成证明
  const { proof, publicSignals } = await generateProof(
    circuitInput,
    wasmPath,
    zkeyPath
  );

  console.log("✅ Proof 生成完成！");

  // 本地验证
  console.log("\n🔍 本地验证 proof...");
  const verified = await verifyProof(proof, publicSignals, vkeyPath);

  if (verified) {
    console.log("✅ Proof 验证通过！");
  } else {
    console.error("❌ Proof 验证失败！");
    process.exit(1);
  }

  // 格式化为 Solidity 格式
  const solidityProof = formatProofForSolidity(proof);

  // 输出结果
  const result = {
    proof: solidityProof,
    publicSignals,
    rawProof: proof,
  };

  // 保存到文件（如果指定）
  const outputPath = argv.output || argv.o;
  if (outputPath) {
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`\n💾 结果已保存到: ${outputPath}`);
  }

  // 输出到控制台
  console.log("\n📦 Proof (Solidity 格式):");
  console.log(JSON.stringify(solidityProof, null, 2));

  console.log("\n📊 Public Signals:");
  console.log(JSON.stringify(publicSignals, null, 2));

  return result;
}

// 如果直接运行
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("❌ 错误:", error);
      process.exit(1);
    });
}

// 导出供测试使用
module.exports = {
  buildCircuitInput,
  generateProof,
  verifyProof,
  formatProofForSolidity,
};
