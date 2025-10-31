const { expect } = require("chai");
const { ethers } = require("hardhat");
const { poseidon } = require("circomlibjs");

/**
 * ZWToken E2E 测试
 * 基于新架构：Poseidon Merkle tree + 首次接收记录
 */
describe("ZWToken - E2E Claim Test", function () {
  let zwToken, underlying, verifier, poseidonT3;
  let deployer, alice, bob;

  const SECRET = 123456789n;

  before(async function () {
    [deployer, alice, bob] = await ethers.getSigners();

    console.log("\n🚀 部署合约...");

    // 1. 部署 PoseidonT3 库
    const PoseidonT3 = await ethers.getContractFactory(
      "poseidon-solidity/PoseidonT3.sol:PoseidonT3"
    );
    poseidonT3 = await PoseidonT3.deploy();
    await poseidonT3.waitForDeployment();
    console.log("✅ PoseidonT3 deployed:", await poseidonT3.getAddress());

    // 2. 部署底层 ERC20
    const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
    underlying = await ERC20Mock.deploy(
      "Underlying Token",
      "UDLT",
      ethers.parseEther("1000000")
    );
    await underlying.waitForDeployment();
    console.log("✅ Underlying deployed:", await underlying.getAddress());

    // 3. 部署 Mock Verifier（总是返回 true）
    const MockVerifier = await ethers.getContractFactory("MockVerifier");
    verifier = await MockVerifier.deploy();
    await verifier.waitForDeployment();
    await verifier.setResult(true); // 设置总是返回 true
    console.log("✅ Verifier deployed:", await verifier.getAddress());

    // 4. 部署 ZWToken (使用完全限定名避免歧义)
    const ZWToken = await ethers.getContractFactory(
      "contracts/ZWToken.sol:ZWToken",
      {
        libraries: {
          PoseidonT3: await poseidonT3.getAddress(),
        },
      }
    );
    const underlyingDecimals = await underlying.decimals();
    zwToken = await ZWToken.deploy(
      "ZK Wrapper Token",
      "ZWT",
      underlyingDecimals, // 从 underlying token 获取 decimals
      await underlying.getAddress(),
      await verifier.getAddress()
    );
    await zwToken.waitForDeployment();
    console.log("✅ ZWToken deployed:", await zwToken.getAddress());

    // 5. 分配 underlying token
    await underlying.transfer(alice.address, ethers.parseEther("1000"));
    console.log("✅ Allocated tokens to Alice");
  });

  it("完整流程：deposit → transfer to privacy address → claim → withdraw", async function () {
    console.log("\n" + "=".repeat(60));
    console.log("📝 测试完整流程");
    console.log("=".repeat(60));

    // ========== 阶段 1: Alice deposit ==========
    console.log("\n📌 阶段 1: Alice deposit underlying token");

    const depositAmount = ethers.parseEther("500");
    await underlying
      .connect(alice)
      .approve(await zwToken.getAddress(), depositAmount);
    await zwToken.connect(alice).deposit(depositAmount);

    const aliceBalance = await zwToken.balanceOf(alice.address);
    console.log(`   Alice ZWT balance: ${ethers.formatEther(aliceBalance)}`);
    expect(aliceBalance).to.equal(depositAmount);

    // 验证 deposit 不记录 commitment
    const commitmentCount1 = await zwToken.getCommitmentCount();
    console.log(`   Commitment count: ${commitmentCount1}`);
    expect(commitmentCount1).to.equal(0); // deposit 不记录

    // ========== 阶段 2: 计算隐私地址并转账 ==========
    console.log("\n📌 阶段 2: 计算隐私地址并转账");

    // 从 secret 推导隐私地址
    const addrScalar = poseidon([SECRET]);
    const addr20 = addrScalar & ((1n << 160n) - 1n);
    const privacyAddress = ethers.getAddress(
      "0x" + addr20.toString(16).padStart(40, "0")
    );

    console.log(`   Secret: ${SECRET}`);
    console.log(`   Privacy address: ${privacyAddress}`);

    // Alice 转账到隐私地址
    const transferAmount = ethers.parseEther("200");
    const tx = await zwToken
      .connect(alice)
      .transfer(privacyAddress, transferAmount);
    const receipt = await tx.wait();

    console.log(`   Transferred ${ethers.formatEther(transferAmount)} ZWT`);

    // 验证转账触发了 commitment 记录
    const commitmentCount2 = await zwToken.getCommitmentCount();
    console.log(`   Commitment count: ${commitmentCount2}`);
    expect(commitmentCount2).to.equal(1); // 首次接收，应该记录

    // 验证 commitment 值（从存储中获取）
    const leaves = await zwToken.getLeafRange(0, 1);
    const storedCommitment = leaves[0];

    expect(storedCommitment.to).to.equal(privacyAddress);
    expect(storedCommitment.amount).to.equal(transferAmount);

    console.log(
      `   Stored commitment - to: ${
        storedCommitment.to
      }, amount: ${ethers.formatEther(storedCommitment.amount)}`
    );

    // 验证隐私地址余额
    const privacyBalance = await zwToken.balanceOf(privacyAddress);
    console.log(
      `   Privacy address balance: ${ethers.formatEther(privacyBalance)}`
    );
    expect(privacyBalance).to.equal(transferAmount);

    // ========== 阶段 3: 构造 ZK proof 数据 ==========
    console.log("\n📌 阶段 3: 构造 ZK proof 数据（模拟前端）");

    // 获取当前 root
    const root = await zwToken.root();
    console.log(`   Current root: ${root}`);

    // 计算 nullifier = Poseidon(addr20, secret)
    const nullifier = poseidon([addr20, SECRET]);
    const nullifierHex = "0x" + nullifier.toString(16).padStart(64, "0");
    console.log(`   Nullifier: ${nullifierHex}`);

    // Mock proof（实际应该由 snarkjs 生成）
    const mockProof = {
      a: [1n, 2n],
      b: [
        [3n, 4n],
        [5n, 6n],
      ],
      c: [7n, 8n],
    };

    console.log(`   ✅ Proof data prepared (mocked)`);

    // ========== 阶段 4: Bob 使用 ZK proof claim ==========
    console.log("\n📌 阶段 4: Bob 使用 ZK proof claim");

    const claimAmount = ethers.parseEther("150");
    console.log(`   Bob address: ${bob.address}`);
    console.log(`   Claim amount: ${ethers.formatEther(claimAmount)}`);

    // 验证 Bob 的初始状态
    const bobBalanceBefore = await zwToken.balanceOf(bob.address);
    expect(bobBalanceBefore).to.equal(0);

    // Bob 提交 claim
    const claimTx = await zwToken.claim(
      mockProof.a,
      mockProof.b,
      mockProof.c,
      root,
      nullifierHex,
      bob.address,
      claimAmount
    );

    // 验证 Claimed 事件
    await expect(claimTx)
      .to.emit(zwToken, "Claimed")
      .withArgs(nullifierHex, bob.address, claimAmount);

    // 验证 commitment 被创建（Bob 首次接收）
    const leafCountAfterClaim = await zwToken.getStoredLeafCount();
    expect(leafCountAfterClaim).to.equal(2); // 1 from privacy address + 1 from claim

    // 验证最新的 commitment 数据
    const claimLeaves = await zwToken.getLeafRange(1, 1);
    expect(claimLeaves[0].to).to.equal(bob.address);
    expect(claimLeaves[0].amount).to.equal(claimAmount);

    const bobBalanceAfter = await zwToken.balanceOf(bob.address);
    console.log(`   Bob ZWT balance: ${ethers.formatEther(bobBalanceAfter)}`);
    expect(bobBalanceAfter).to.equal(claimAmount);

    // 验证 commitment 增加
    const commitmentCount3 = await zwToken.getCommitmentCount();
    console.log(`   Commitment count: ${commitmentCount3}`);
    expect(commitmentCount3).to.equal(2); // privacy address + bob

    // ========== 阶段 5: Bob withdraw underlying token ==========
    console.log("\n📌 阶段 5: Bob withdraw underlying token");

    const bobUnderlyingBefore = await underlying.balanceOf(bob.address);
    console.log(
      `   Bob underlying before: ${ethers.formatEther(bobUnderlyingBefore)}`
    );

    await zwToken.connect(bob).withdraw(claimAmount);

    const bobUnderlyingAfter = await underlying.balanceOf(bob.address);
    const bobZWTAfter = await zwToken.balanceOf(bob.address);

    console.log(
      `   Bob underlying after: ${ethers.formatEther(bobUnderlyingAfter)}`
    );
    console.log(`   Bob ZWT after: ${ethers.formatEther(bobZWTAfter)}`);

    expect(bobUnderlyingAfter).to.equal(bobUnderlyingBefore + claimAmount);
    expect(bobZWTAfter).to.equal(0);

    // ========== 阶段 6: 测试防重放 ==========
    console.log("\n📌 阶段 6: 测试防重放");

    await expect(
      zwToken.claim(
        mockProof.a,
        mockProof.b,
        mockProof.c,
        root,
        nullifierHex,
        bob.address,
        claimAmount
      )
    ).to.be.revertedWithCustomError(zwToken, "NullifierUsed");

    console.log("   ✅ 防重放验证通过");

    console.log("\n" + "=".repeat(60));
    console.log("✅ 完整流程测试通过！");
    console.log("=".repeat(60));
  });

  it("测试 claim 到已有余额的地址", async function () {
    console.log("\n" + "=".repeat(60));
    console.log("📝 测试 claim 到已有余额的地址");
    console.log("=".repeat(60));

    // 使用新的 secret
    const SECRET2 = 987654321n;
    const addrScalar2 = poseidon([SECRET2]);
    const addr20_2 = addrScalar2 & ((1n << 160n) - 1n);
    const privacyAddress2 = ethers.getAddress(
      "0x" + addr20_2.toString(16).padStart(40, "0")
    );

    console.log(`\n📌 准备：Alice 转账到新隐私地址`);
    console.log(`   Privacy address 2: ${privacyAddress2}`);

    // Alice 转账到新隐私地址
    const transferAmount2 = ethers.parseEther("100");
    await zwToken.connect(alice).transfer(privacyAddress2, transferAmount2);
    console.log(`   ✅ Transferred ${ethers.formatEther(transferAmount2)} ZWT`);

    // 获取当前状态
    const commitmentCountBefore = await zwToken.getCommitmentCount();
    const root2 = await zwToken.root();
    const nullifier2 = poseidon([addr20_2]);
    const nullifierHex2 = "0x" + nullifier2.toString(16).padStart(64, "0");

    console.log(`   Current commitment count: ${commitmentCountBefore}`);

    // Bob 再次 claim（这次不应该增加新 commitment，因为 Bob 已经有记录了）
    console.log(`\n📌 Bob 再次 claim（不应增加 commitment）`);

    const claimAmount2 = ethers.parseEther("50");
    const bobBalanceBefore = await zwToken.balanceOf(bob.address);
    console.log(
      `   Bob balance before: ${ethers.formatEther(bobBalanceBefore)}`
    );

    const mockProof2 = {
      a: [9n, 10n],
      b: [
        [11n, 12n],
        [13n, 14n],
      ],
      c: [15n, 16n],
    };

    // Bob claim（不应该 emit CommitmentAdded）
    const claimTx = await zwToken.claim(
      mockProof2.a,
      mockProof2.b,
      mockProof2.c,
      root2,
      nullifierHex2,
      bob.address,
      claimAmount2
    );

    // 应该 emit Claimed
    await expect(claimTx)
      .to.emit(zwToken, "Claimed")
      .withArgs(nullifierHex2, bob.address, claimAmount2);

    // 不应该创建新的 commitment（Bob 已经有记录）
    const leafCountAfterSecondClaim = await zwToken.getStoredLeafCount();
    expect(leafCountAfterSecondClaim).to.equal(3); // 应该仍然是 3 个 commitment（没有为 Bob 创建新的）
    console.log("   ✅ No new commitment created (as expected)");

    // 验证余额增加
    const bobBalanceAfter = await zwToken.balanceOf(bob.address);
    console.log(`   Bob balance after: ${ethers.formatEther(bobBalanceAfter)}`);
    expect(bobBalanceAfter).to.equal(bobBalanceBefore + claimAmount2);

    // 验证 commitment count 不变
    const commitmentCountAfter = await zwToken.getCommitmentCount();
    console.log(`   Commitment count after: ${commitmentCountAfter}`);
    expect(commitmentCountAfter).to.equal(commitmentCountBefore);

    console.log("\n" + "=".repeat(60));
    console.log("✅ 测试通过：claim 到已有地址不增加 commitment");
    console.log("=".repeat(60));
  });

  it("测试 Merkle root 历史支持", async function () {
    console.log("\n" + "=".repeat(60));
    console.log("📝 测试 Merkle root 历史支持");
    console.log("=".repeat(60));

    // 使用新的 secret
    const SECRET3 = 111111111n;
    const addrScalar3 = poseidon([SECRET3]);
    const addr20_3 = addrScalar3 & ((1n << 160n) - 1n);
    const privacyAddress3 = ethers.getAddress(
      "0x" + addr20_3.toString(16).padStart(40, "0")
    );

    console.log(`\n📌 步骤 1: 记录旧 root`);

    // Alice 转账到隐私地址 3
    const transferAmount3 = ethers.parseEther("80");
    await zwToken.connect(alice).transfer(privacyAddress3, transferAmount3);

    const oldRoot = await zwToken.root();
    console.log(`   Old root: ${oldRoot}`);

    // 再转一笔给其他地址，更新 root
    console.log(`\n📌 步骤 2: 更新 root（转账给新地址）`);

    const SECRET4 = 222222222n;
    const addrScalar4 = poseidon([SECRET4]);
    const addr20_4 = addrScalar4 & ((1n << 160n) - 1n);
    const privacyAddress4 = ethers.getAddress(
      "0x" + addr20_4.toString(16).padStart(40, "0")
    );

    await zwToken
      .connect(alice)
      .transfer(privacyAddress4, ethers.parseEther("30"));

    const newRoot = await zwToken.root();
    console.log(`   New root: ${newRoot}`);
    expect(newRoot).to.not.equal(oldRoot);

    // 使用旧 root 进行 claim
    console.log(`\n📌 步骤 3: 使用旧 root claim（应该成功）`);

    const nullifier3 = poseidon([addr20_3]);
    const nullifierHex3 = "0x" + nullifier3.toString(16).padStart(64, "0");

    const mockProof3 = {
      a: [17n, 18n],
      b: [
        [19n, 20n],
        [21n, 22n],
      ],
      c: [23n, 24n],
    };

    // 使用 deployer claim（新地址）
    const claimAmount3 = ethers.parseEther("60");

    // 应该成功（oldRoot 仍然有效）
    await expect(
      zwToken.claim(
        mockProof3.a,
        mockProof3.b,
        mockProof3.c,
        oldRoot, // 使用旧 root
        nullifierHex3,
        deployer.address,
        claimAmount3
      )
    ).to.emit(zwToken, "Claimed");

    console.log("   ✅ Claim with old root succeeded");

    const deployerBalance = await zwToken.balanceOf(deployer.address);
    console.log(`   Deployer balance: ${ethers.formatEther(deployerBalance)}`);
    expect(deployerBalance).to.equal(claimAmount3);

    console.log("\n" + "=".repeat(60));
    console.log("✅ 测试通过：支持历史 root");
    console.log("=".repeat(60));
  });
});
