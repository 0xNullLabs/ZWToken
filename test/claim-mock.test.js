const { expect } = require("chai");
const { ethers } = require("hardhat");
const circomlibjs = require("circomlibjs");

function zbytes32(hex) {
  return ethers.zeroPadValue(hex, 32);
}

describe("ZWToken claim with mocked proof data", function () {
  let sourceToken, ZWToken, verifier;
  let deployer, userB;

  const MAGIC = 42n;
  const SECRET = 123456789n;

  before(async function () {
    [deployer, userB] = await ethers.getSigners();

    // 部署底层 ERC20
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    sourceToken = await MockERC20.deploy(
      "Source Token",
      "SRC",
      ethers.parseEther("1000000")
    );
    await sourceToken.waitForDeployment();

    // 部署 Mock Verifier（总是返回 true）
    const DevMockVerifier = await ethers.getContractFactory("DevMockVerifier");
    verifier = await DevMockVerifier.deploy();
    await verifier.waitForDeployment();

    // 部署 ZWToken
    const ZWTokenFactory = await ethers.getContractFactory("ZWToken");
    ZWToken = await ZWTokenFactory.deploy(
      "ZK Wrapped Token",
      "ZKW",
      await sourceToken.getAddress(),
      await verifier.getAddress(),
      10
    );
    await ZWToken.waitForDeployment();
  });

  it("完整流程：deposit → mock 证明 → claim（无需 eth_getProof）", async function () {
    // === 阶段 1: 计算隐私地址并 deposit ===
    console.log("\n=== 阶段 1: 计算隐私地址并 deposit ===");

    const poseidonHash = circomlibjs.poseidon;
    const addrScalar = poseidonHash([MAGIC, SECRET]);
    const addr20Bi = addrScalar & ((1n << 160n) - 1n);
    const addressA = ethers.getAddress(
      "0x" + addr20Bi.toString(16).padStart(40, "0")
    );

    console.log("Secret:", SECRET.toString());
    console.log("隐私地址 A:", addressA);

    // 向隐私地址转入 source token
    const depositAmount = ethers.parseEther("1000");
    await sourceToken.transfer(addressA, depositAmount);

    // 从隐私地址 approve 并 deposit（这里需要模拟，实际中用户会用自己的私钥）
    // 为了测试，我们让 deployer 直接 deposit
    await sourceToken.approve(await ZWToken.getAddress(), depositAmount);
    await ZWToken.deposit(depositAmount);

    console.log(
      "Deployer 的 ZKW 余额:",
      ethers.formatEther(await ZWToken.balanceOf(deployer.address))
    );

    // === 阶段 2: 跳过 eth_getProof，直接构造测试数据 ===
    console.log("\n=== 阶段 2: 跳过 eth_getProof（使用 mock 数据）===");

    // Mine 几个块
    await ethers.provider.send("hardhat_mine", ["0x5"]);
    const head = await ethers.provider.getBlockNumber();
    const targetBlock = head - 2;
    const block = await ethers.provider.getBlock(targetBlock);

    console.log("目标区块:", targetBlock);
    console.log("区块哈希:", block.hash);

    // 使用 ZeroHash 作为 stateRoot（mock 测试不验证真实状态）
    const stateRoot = ethers.ZeroHash;

    // === 阶段 3: 构造 claim 参数 ===
    console.log("\n=== 阶段 3: 构造 claim 参数 ===");

    const chainId = (await ethers.provider.getNetwork()).chainId;
    const nullifier = poseidonHash([
      SECRET,
      chainId,
      BigInt(await ZWToken.getAddress()),
    ]);
    const nullifierHex = zbytes32("0x" + nullifier.toString(16));

    console.log("Nullifier:", nullifierHex);

    // Mock 证明参数（DevMockVerifier 会接受任何证明）
    const a = [1n, 2n];
    const b = [
      [3n, 4n],
      [5n, 6n],
    ];
    const c = [7n, 8n];

    const claimAmount = ethers.parseEther("100");
    const recipient = await userB.getAddress();

    // === 阶段 4: 调用 claim ===
    console.log("\n=== 阶段 4: 执行 claim ===");

    await expect(
      ZWToken.claim(
        a,
        b,
        c,
        block.hash,
        targetBlock,
        stateRoot,
        claimAmount,
        nullifierHex,
        recipient
      )
    )
      .to.emit(ZWToken, "Claimed")
      .withArgs(nullifierHex, recipient, claimAmount);

    const recipientBalance = await ZWToken.balanceOf(recipient);
    console.log("接收者 ZKW 余额:", ethers.formatEther(recipientBalance));

    expect(recipientBalance).to.equal(claimAmount);

    // === 测试防重放 ===
    console.log("\n=== 测试防重放 ===");

    await expect(
      ZWToken.claim(
        a,
        b,
        c,
        block.hash,
        targetBlock,
        stateRoot,
        claimAmount,
        nullifierHex,
        recipient
      )
    ).to.be.revertedWith("nullifier used");

    console.log("✅ 防重放测试通过");
  });
});
