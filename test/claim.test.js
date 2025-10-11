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

  it("完整流程：deposit → 转给隐私地址 → claim → withdraw", async function () {
    // === 阶段 1: deployer 存入 sourceToken 获得 ZWToken ===
    console.log("\n=== 阶段 1: deployer 存入 sourceToken 获得 ZWToken ===");

    const depositAmount = ethers.parseEther("1000");
    await sourceToken.approve(await ZWToken.getAddress(), depositAmount);
    await ZWToken.deposit(depositAmount);

    console.log(
      "Deployer 的 ZWToken 余额:",
      ethers.formatEther(await ZWToken.balanceOf(deployer.address))
    );

    // === 阶段 2: 计算隐私地址 A 并转账 ZWToken ===
    console.log("\n=== 阶段 2: 计算隐私地址 A 并转账 ZWToken ===");

    const poseidonHash = circomlibjs.poseidon;
    const addrScalar = poseidonHash([MAGIC, SECRET]);
    const addr20Bi = addrScalar & ((1n << 160n) - 1n);
    const addressA = ethers.getAddress(
      "0x" + addr20Bi.toString(16).padStart(40, "0")
    );

    console.log("Secret:", SECRET.toString());
    console.log("隐私地址 A:", addressA);

    // deployer 将 ZWToken 转给隐私地址 A
    const transferAmount = ethers.parseEther("200");
    await ZWToken.transfer(addressA, transferAmount);

    console.log(
      "隐私地址 A 的 ZWToken 余额:",
      ethers.formatEther(await ZWToken.balanceOf(addressA))
    );

    // === 阶段 3: Mine 区块并获取区块信息 ===
    console.log("\n=== 阶段 3: Mine 区块并获取区块信息 ===");

    // Mine 几个块
    await ethers.provider.send("hardhat_mine", ["0x5"]);
    const head = await ethers.provider.getBlockNumber();
    const targetBlock = head - 2;
    const block = await ethers.provider.getBlock(targetBlock);

    console.log("目标区块:", targetBlock);
    console.log("区块哈希:", block.hash);
    console.log("区块状态根:", block.stateRoot);

    // Hardhat Network 默认不支持 stateRoot
    const stateRoot = block.stateRoot || ethers.ZeroHash;

    // === 阶段 4: 为隐私地址 A 构造 zkProof ===
    console.log("\n=== 阶段 4: 为隐私地址 A 构造 zkProof ===");

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

    // B's cliamAccount <= A's balance
    const claimAmount = ethers.parseEther("100");

    // === 阶段 5: 新地址 C (userB) 使用 zkProof 调用 claim ===
    console.log("\n=== 阶段 5: 新地址 C (userB) 使用 zkProof 调用 claim ===");

    const userBAddress = await userB.getAddress();
    console.log("新地址 C (userB):", userBAddress);

    // userB 提交 claim
    // 注意：不再需要传递 headerHash 和 stateRoot
    await expect(
      ZWToken.connect(userB).claim(
        a,
        b,
        c,
        targetBlock,
        claimAmount,
        nullifierHex,
        userBAddress
      )
    )
      .to.emit(ZWToken, "Claimed")
      .withArgs(nullifierHex, userBAddress, claimAmount);

    const userBZWTokenBalance = await ZWToken.balanceOf(userBAddress);
    console.log(
      "新地址 C (userB) 的 ZWToken 余额:",
      ethers.formatEther(userBZWTokenBalance)
    );
    expect(userBZWTokenBalance).to.equal(claimAmount);

    // === 阶段 6: 新地址 C (userB) 通过 withdraw 取回 sourceToken ===
    console.log(
      "\n=== 阶段 6: 新地址 C (userB) 通过 withdraw 取回 sourceToken ==="
    );

    const userBSourceTokenBefore = await sourceToken.balanceOf(userBAddress);
    console.log(
      "withdraw 前 userB 的 sourceToken 余额:",
      ethers.formatEther(userBSourceTokenBefore)
    );

    // userB 调用 withdraw
    await ZWToken.connect(userB).withdraw(claimAmount);

    const userBSourceTokenAfter = await sourceToken.balanceOf(userBAddress);
    const userBZWTokenAfter = await ZWToken.balanceOf(userBAddress);

    console.log(
      "withdraw 后 userB 的 sourceToken 余额:",
      ethers.formatEther(userBSourceTokenAfter)
    );
    console.log(
      "withdraw 后 userB 的 ZWToken 余额:",
      ethers.formatEther(userBZWTokenAfter)
    );

    expect(userBSourceTokenAfter).to.equal(
      userBSourceTokenBefore + claimAmount
    );
    expect(userBZWTokenAfter).to.equal(0);

    console.log("✅ 完整流程测试通过");

    // === 测试防重放 ===
    console.log("\n=== 测试防重放 ===");

    await expect(
      ZWToken.connect(userB).claim(
        a,
        b,
        c,
        targetBlock,
        claimAmount,
        nullifierHex,
        userBAddress
      )
    ).to.be.revertedWith("nullifier used");

    console.log("✅ 防重放测试通过");
  });
});
