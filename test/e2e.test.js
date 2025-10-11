const { expect } = require("chai");
const { ethers } = require("hardhat");
const circomlibjs = require("circomlibjs");
const {
  buildCircuitInput,
  generateProof,
  formatProofForSolidity,
} = require("../client/generate_proof");
const path = require("path");

describe("E2E ZK Wrapper Token Flow (Real ZK Proof)", function () {
  let sourceToken;
  let ZWToken;
  let verifier;
  let deployer, userB;

  const MAGIC = 0n; // 必须与电路编译时的 MAGIC 参数一致！
  const SECRET = 123456789n;

  before(async function () {
    [deployer, userB] = await ethers.getSigners();

    // 1. 部署原始 ERC20 代币
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    sourceToken = await MockERC20.deploy(
      "Source Token",
      "SRC",
      ethers.parseEther("1000000")
    );
    await sourceToken.waitForDeployment();
    console.log("Source token deployed:", await sourceToken.getAddress());

    // 2. 部署真实的 Groth16Verifier（从电路生成的）
    // 注意：接口已与 DevMockVerifier 统一，都使用 uint[8] 固定数组
    const Groth16Verifier = await ethers.getContractFactory("Groth16Verifier");
    verifier = await Groth16Verifier.deploy();
    await verifier.waitForDeployment();
    console.log("✅ Groth16Verifier deployed:", await verifier.getAddress());

    // 3. 部署 ZWToken
    const ZWTokenFactory = await ethers.getContractFactory("ZWToken");
    ZWToken = await ZWTokenFactory.deploy(
      "ZK Wrapped Token",
      "ZKW",
      await sourceToken.getAddress(),
      await verifier.getAddress(),
      10
    );
    await ZWToken.waitForDeployment();
    console.log("ZWToken deployed:", await ZWToken.getAddress());
  });

  it("完整流程：deposit → 转到隐私地址 → 生成真实 ZK proof → claim", async function () {
    this.timeout(120000); // 120秒超时（生成证明需要时间）

    // === 阶段 1: deployer deposit 获得 ZWToken ===
    console.log("\n=== 阶段 1: deployer deposit 获得 ZWToken ===");

    const amount = ethers.parseEther("1000");

    await sourceToken.approve(await ZWToken.getAddress(), amount);
    await ZWToken.deposit(amount);

    const deployerBalance = await ZWToken.balanceOf(deployer.address);
    console.log(
      "Deployer 的 ZWToken 余额:",
      ethers.formatEther(deployerBalance)
    );
    expect(deployerBalance).to.equal(amount);

    // === 阶段 2: 计算隐私地址 A 并转账 ZWToken ===
    console.log("\n=== 阶段 2: 计算隐私地址 A 并转账 ZWToken ===");

    const poseidonHash = circomlibjs.poseidon;
    const addrScalar = poseidonHash([MAGIC, SECRET]);
    const addr20Bi = addrScalar & ((1n << 160n) - 1n);
    const addressA = ethers.getAddress(
      "0x" + addr20Bi.toString(16).padStart(40, "0")
    );

    console.log("Secret:", SECRET.toString());
    console.log("隐私地址 A（无私钥黑洞地址）:", addressA);

    await ZWToken.transfer(addressA, amount);

    const balanceA = await ZWToken.balanceOf(addressA);
    console.log("地址 A 的 ZKW 余额:", ethers.formatEther(balanceA));
    expect(balanceA).to.equal(amount);

    // === 阶段 3: 获取状态证明 ===
    console.log("\n=== 阶段 3: 获取状态证明 ===");

    // Mine 几个块
    await ethers.provider.send("hardhat_mine", ["0x5"]);
    const head = await ethers.provider.getBlockNumber();
    const targetBlock = head - 2;
    const block = await ethers.provider.getBlock(targetBlock);

    console.log("目标区块:", targetBlock);
    console.log("区块哈希:", block.hash);

    // 计算 storage slot key
    const slot0 = ethers.zeroPadValue(ethers.toBeHex(0), 32);
    const addressPadded = ethers.zeroPadValue(addressA, 32);
    const slotKey = ethers.keccak256(ethers.concat([addressPadded, slot0]));

    // eth_getProof
    const proof = await ethers.provider.send("eth_getProof", [
      await ZWToken.getAddress(),
      [slotKey],
      ethers.toBeHex(targetBlock),
    ]);

    console.log("Storage proof 获取成功");

    // 验证余额
    const balanceAAtTargetBlock = await ZWToken.balanceOf(addressA, {
      blockTag: targetBlock,
    });
    const storageValue = BigInt(proof.storageProof[0].value);
    expect(storageValue).to.equal(balanceAAtTargetBlock);
    console.log("✅ storageProof 验证通过");

    // === 阶段 4: 生成真实的 ZK 证明 ===
    console.log("\n=== 阶段 4: 生成真实的 ZK 证明 ===");
    console.log("⚠️  注意：生成证明需要 30-60 秒，请耐心等待...");

    const chainId = (await ethers.provider.getNetwork()).chainId;
    const nullifier = poseidonHash([
      SECRET,
      chainId,
      BigInt(await ZWToken.getAddress()),
    ]);
    const nullifierHex = ethers.zeroPadValue("0x" + nullifier.toString(16), 32);

    console.log("Nullifier:", nullifierHex);

    // 构建电路输入
    const circuitInput = await buildCircuitInput({
      secret: SECRET,
      magic: MAGIC,
      headerHash: block.hash,
      blockNumber: targetBlock,
      stateRoot: block.stateRoot || proof.storageHash || ethers.ZeroHash,
      amount: balanceA,
      chainId: chainId,
      contractAddr: await ZWToken.getAddress(),
      to: userB.address,
      balance: balanceA, // 地址 A 在目标区块的余额
    });

    // 路径配置
    const projectRoot = path.join(__dirname, "..");
    const wasmPath = path.join(
      projectRoot,
      "circuits/out/claim_from_state_root_js/claim_from_state_root.wasm"
    );
    const zkeyPath = path.join(projectRoot, "circuits/out/claim_final.zkey");

    // 生成证明（这是真实的 ZK proof！）
    const { proof: zkProof, publicSignals } = await generateProof(
      circuitInput,
      wasmPath,
      zkeyPath
    );

    console.log("✅ 真实的 ZK Proof 生成成功！");
    console.log("📊 Public Signals (共 %d 个):", publicSignals.length);
    console.log("  [0] headerHashHi:", publicSignals[0]);
    console.log("  [1] headerHashLo:", publicSignals[1]);
    console.log("  [2] amount:", publicSignals[2]);
    console.log("  [3] nullifier:", publicSignals[3]);
    console.log("  [4] chainId:", publicSignals[4]);
    console.log("  [5] contractAddr:", publicSignals[5]);
    console.log("  [6] to:", publicSignals[6]);

    // 格式化为 Solidity 格式
    const solidityProof = formatProofForSolidity(zkProof);

    console.log("\n🔍 验证输入参数:");
    console.log("  headerHash (预期):", block.hash);
    console.log("  blockNumber (预期):", targetBlock);
    console.log(
      "  stateRoot (预期):",
      block.stateRoot || proof.storageHash || ethers.ZeroHash
    );
    console.log("  amount (预期):", balanceA.toString());
    console.log("  nullifier (预期):", nullifierHex);

    // === 阶段 5: 使用真实 ZK Proof 提交 claim ===
    console.log("\n=== 阶段 5: 使用真实 ZK Proof 提交 claim ===");

    console.log("接收地址 B:", userB.address);
    console.log(
      "接收地址 B 初始 ZKW 余额:",
      ethers.formatEther(await ZWToken.balanceOf(userB.address))
    );

    const balanceABeforeClaim = await ZWToken.balanceOf(addressA);
    console.log(
      "地址 A claim 前的 ZKW 余额:",
      ethers.formatEther(balanceABeforeClaim)
    );

    // 使用真实的 ZK proof 发起 claim
    // 注意：不再需要传递 headerHash 和 stateRoot，合约会通过 blockhash(blockNumber) 获取
    const claimTx = await ZWToken.connect(deployer).claim(
      solidityProof.a,
      solidityProof.b,
      solidityProof.c,
      targetBlock,
      balanceA,
      nullifierHex,
      userB.address
    );
    const receipt = await claimTx.wait();

    console.log("✅ Claim 交易成功！Gas used:", receipt.gasUsed.toString());

    // 验证事件
    const claimedEvent = receipt.logs.find(
      (log) => log.fragment && log.fragment.name === "Claimed"
    );
    expect(claimedEvent).to.not.be.undefined;
    console.log("✅ Claimed 事件已触发");

    const balanceB = await ZWToken.balanceOf(userB.address);
    console.log("接收地址 B 最终 ZKW 余额:", ethers.formatEther(balanceB));

    expect(balanceB).to.equal(amount);
    console.log("✅ 使用真实 ZK Proof 的 claim 成功！");

    // === 阶段 6: 验证防重领 ===
    console.log("\n=== 阶段 6: 验证防重领 ===");

    await expect(
      ZWToken.connect(deployer).claim(
        solidityProof.a,
        solidityProof.b,
        solidityProof.c,
        targetBlock,
        balanceA,
        nullifierHex,
        userB.address
      )
    ).to.be.reverted; // Anvil 的 revert 消息格式可能不同，使用通用的 reverted

    console.log("✅ 防重领验证通过");

    console.log("\n=== 测试完成 ===");
    console.log("🎉 真实的 ZK Proof 测试全部通过！");
    console.log("隐私地址 A:", addressA);
    console.log("地址 A 的 ZKW 余额:", ethers.formatEther(balanceABeforeClaim));
    console.log("接收地址 B:", userB.address);
    console.log("地址 B 的 ZKW 余额:", ethers.formatEther(balanceB));
    console.log(
      "\n说明：地址 A 通过真实的 ZK 证明向地址 B claim 了等量的 ZKW token"
    );
  });
});
