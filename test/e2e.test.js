const { expect } = require("chai");
const { ethers } = require("hardhat");
const circomlibjs = require("circomlibjs");
const rlp = require("rlp");

describe("E2E ZK Wrapper Token Flow", function () {
  let sourceToken; // 原始 ERC20（底层资产）
  let ZWToken; // ZWToken（Wrapped Token，支持 ZK claim）
  let verifier;
  let deployer, userB;

  const MAGIC = 42n; // 示例 MAGIC 值
  const SECRET = 123456789n; // 用户的 secret

  before(async function () {
    [deployer, userB] = await ethers.getSigners();

    // 1. 部署原始 ERC20 代币（底层资产）
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    sourceToken = await MockERC20.deploy(
      "Source Token",
      "SRC",
      ethers.parseEther("1000000") // 初始供应量
    );
    await sourceToken.waitForDeployment();
    console.log("Source token deployed:", await sourceToken.getAddress());

    // 2. 部署 Verifier（使用 Mock 版本，因为真实证明需要完整的电路实现）
    // TODO: 完成电路 RLP/Keccak/MPT 实现后，改用 Groth16Verifier
    const DevMockVerifier = await ethers.getContractFactory("DevMockVerifier");
    verifier = await DevMockVerifier.deploy();
    await verifier.waitForDeployment();
    console.log("Verifier deployed:", await verifier.getAddress());

    // 3. 部署 ZWToken（Wrapped Token）
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

  it("完整流程：deposit 到隐私地址 → 生成证明 → claim 到新地址", async function () {
    this.timeout(60000); // 60秒超时

    // === 阶段 1: 计算隐私地址 A 并 deposit ===
    console.log("\n=== 阶段 1: 计算隐私地址并 deposit ===");

    const poseidonHash = circomlibjs.poseidon;
    const addrScalar = poseidonHash([MAGIC, SECRET]);
    const addr20Bi = addrScalar & ((1n << 160n) - 1n);
    const addressA = ethers.getAddress(
      "0x" + addr20Bi.toString(16).padStart(40, "0")
    );

    console.log("Secret:", SECRET.toString());
    console.log("隐私地址 A:", addressA);

    // 向地址 A 转入 1000 source tokens
    const amount = ethers.parseEther("1000");
    await sourceToken.transfer(addressA, amount);
    console.log(
      "地址 A 的 source token 余额:",
      ethers.formatEther(await sourceToken.balanceOf(addressA))
    );

    // 从地址 A deposit 到 ZWToken（需要用 impersonated account）
    await ethers.provider.send("hardhat_impersonateAccount", [addressA]);
    const signerA = await ethers.getSigner(addressA);

    // 给地址 A 一些 ETH 用于 gas
    await deployer.sendTransaction({
      to: addressA,
      value: ethers.parseEther("1"),
    });

    // 授权并 deposit
    await sourceToken
      .connect(signerA)
      .approve(await ZWToken.getAddress(), amount);
    await ZWToken.connect(signerA).deposit(amount);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [addressA]);

    const balanceA = await ZWToken.balanceOf(addressA);
    console.log("地址 A 的 ZKW 余额:", ethers.formatEther(balanceA));
    expect(balanceA).to.equal(amount);

    // === 阶段 2: 获取余额证明 ===
    console.log("\n=== 阶段 2: 获取状态证明 ===");

    // Mine 几个块以便有 head-2
    await ethers.provider.send("hardhat_mine", ["0x5"]);
    const head = await ethers.provider.getBlockNumber();
    const targetBlock = head - 2;
    const block = await ethers.provider.getBlock(targetBlock);

    console.log("目标区块:", targetBlock);
    console.log("区块哈希:", block.hash);

    // 计算 storage slot key（注意：现在是 ZWToken 的余额）
    const slot0 = ethers.zeroPadValue(ethers.toBeHex(0), 32);
    const addressPadded = ethers.zeroPadValue(addressA, 32);
    const slotKey = ethers.keccak256(ethers.concat([addressPadded, slot0]));

    // eth_getProof（获取 ZWToken 的余额证明）
    const proof = await ethers.provider.send("eth_getProof", [
      await ZWToken.getAddress(),
      [slotKey],
      ethers.toBeHex(targetBlock),
    ]);

    console.log("Storage proof 获取成功");
    console.log("余额值:", proof.storageProof[0].value);

    // === 阶段 3: 生成 ZK 证明（占位版） ===
    console.log("\n=== 阶段 3: 构造证明输入 ===");

    // 计算 nullifier
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const nullifier = poseidonHash([
      SECRET,
      chainId,
      BigInt(await ZWToken.getAddress()),
    ]);
    const nullifierHex = ethers.zeroPadValue("0x" + nullifier.toString(16), 32);

    console.log("Nullifier:", nullifierHex);

    // 构造公共输入（与电路一致）
    // 注意：Anvil 返回的区块对象可能没有 stateRoot，使用 proof 中的 storageHash 或 ZeroHash 作为占位
    const publicInputs = {
      headerHash: block.hash,
      blockNumber: targetBlock,
      stateRoot: block.stateRoot || proof.storageHash || ethers.ZeroHash,
      amount: balanceA,
      nullifier: nullifierHex,
      chainId: Number(chainId),
      contractAddr: await ZWToken.getAddress(),
      to: userB.address,
    };

    console.log("公共输入已构造");

    // === 阶段 4: 提交 claim 到新地址 B ===
    console.log("\n=== 阶段 4: 提交 claim 到新地址 B ===");

    // 占位 proof（真实场景需要用 snarkjs 生成）
    const dummyProof = {
      a: [1n, 2n],
      b: [
        [3n, 4n],
        [5n, 6n],
      ],
      c: [7n, 8n],
    };

    console.log("接收地址 B:", userB.address);
    console.log(
      "接收地址 B 初始 ZKW 余额:",
      ethers.formatEther(await ZWToken.balanceOf(userB.address))
    );

    // 记录 claim 前地址 A 的余额
    const balanceABeforeClaim = await ZWToken.balanceOf(addressA);
    console.log(
      "地址 A claim 前的 ZKW 余额:",
      ethers.formatEther(balanceABeforeClaim)
    );

    // 发起 claim
    await expect(
      ZWToken.connect(deployer).claim(
        dummyProof.a,
        dummyProof.b,
        dummyProof.c,
        publicInputs.headerHash,
        publicInputs.blockNumber,
        publicInputs.stateRoot,
        publicInputs.amount,
        publicInputs.nullifier,
        publicInputs.to
      )
    )
      .to.emit(ZWToken, "Claimed")
      .withArgs(nullifierHex, userB.address, balanceA);

    const balanceB = await ZWToken.balanceOf(userB.address);
    console.log("接收地址 B 最终 ZKW 余额:", ethers.formatEther(balanceB));

    // claim 会 mint 新的代币到地址 B
    expect(balanceB).to.equal(amount);

    // === 阶段 5: 验证防重领 ===
    console.log("\n=== 阶段 5: 验证防重领 ===");

    // 注意：Anvil 的 revert 消息格式可能与 Hardhat 不同
    await expect(
      ZWToken.connect(deployer).claim(
        dummyProof.a,
        dummyProof.b,
        dummyProof.c,
        publicInputs.headerHash,
        publicInputs.blockNumber,
        publicInputs.stateRoot,
        publicInputs.amount,
        publicInputs.nullifier,
        publicInputs.to
      )
    ).to.be.reverted;

    console.log("✅ 防重领验证通过");

    console.log("\n=== 测试完成 ===");
    console.log("隐私地址 A:", addressA);
    console.log("地址 A 的 ZKW 余额:", ethers.formatEther(balanceABeforeClaim));
    console.log("接收地址 B:", userB.address);
    console.log("地址 B 的 ZKW 余额:", ethers.formatEther(balanceB));
    console.log("\n说明：地址 A 通过 ZK 证明向地址 B claim 了等量的 ZKW token");
  });
});
