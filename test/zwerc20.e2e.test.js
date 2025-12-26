const { expect } = require("chai");
const { ethers } = require("hardhat");
const { IncrementalMerkleTree } = require("../utils/merkle-tree-utils");
const {
  createZWConfig,
  derivePrivacyAddress,
  calculateNullifier,
  generateZKProof,
  deployPoseidonT3,
  deployVerifier,
  poseidon,
} = require("./helpers/test-utils");

/**
 * ZWERC20 E2E Test - Real ZK Proof
 */
describe("ZWERC20 - E2E with Real ZK Proof", function () {
  let zwToken, underlying, verifier, poseidonT3;
  let deployer, alice, bob;

  const SECRET = 123456789n;

  before(async function () {
    [deployer, alice, bob] = await ethers.getSigners();

    console.log("\n" + "=".repeat(70));
    console.log("🚀 Deploying ZWERC20 contracts");
    console.log("=".repeat(70));

    // 1. Deploy PoseidonT3 library
    poseidonT3 = await deployPoseidonT3();
    console.log("✅ PoseidonT3:", await poseidonT3.getAddress());

    // 2. Deploy underlying ERC20
    const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
    underlying = await ERC20Mock.deploy(
      "Underlying Token",
      "UDLT",
      ethers.parseEther("1000000")
    );
    await underlying.waitForDeployment();
    console.log("✅ Underlying:", await underlying.getAddress());

    // 3. Deploy Groth16Verifier
    try {
      verifier = await deployVerifier();
      console.log("✅ Groth16Verifier:", await verifier.getAddress());
    } catch (error) {
      console.log("\n❌ Groth16Verifier not found!");
      console.log("📋 Please compile the circuit first:");
      console.log("   Run: ./scripts/build_circuit.sh");
      throw new Error("Groth16Verifier contract not found.");
    }

    // 4. Deploy ZWERC20 with ZWConfig struct
    const ZWERC20 = await ethers.getContractFactory(
      "contracts/ZWERC20.sol:ZWERC20",
      {
        libraries: {
          PoseidonT3: await poseidonT3.getAddress(),
        },
      }
    );
    const underlyingDecimals = await underlying.decimals();
    const config = createZWConfig(
      await verifier.getAddress(),
      deployer.address
    );
    zwToken = await ZWERC20.deploy(
      "ZK Wrapper Token",
      "ZWT",
      underlyingDecimals,
      await underlying.getAddress(),
      config
    );
    await zwToken.waitForDeployment();
    console.log("✅ ZWERC20:", await zwToken.getAddress());

    // 5. Allocate underlying tokens
    await underlying.transfer(alice.address, ethers.parseEther("10000"));
    console.log("✅ Allocated 10000 tokens to Alice");
  });

  it("Full workflow: deposit → transfer → generate real ZK proof → remint", async function () {
    this.timeout(180000);

    console.log("\n" + "=".repeat(70));
    console.log("📝 ZWERC20 E2E Test: Real ZK Proof");
    console.log("=".repeat(70));

    // ========== Phase 1: Alice deposit ==========
    console.log("\n📌 Phase 1: Alice deposit underlying token");

    const depositAmount = ethers.parseEther("1000");
    await underlying
      .connect(alice)
      .approve(await zwToken.getAddress(), depositAmount);
    await zwToken.connect(alice).deposit(alice.address, 0, depositAmount, "0x");

    const aliceBalance = await zwToken.balanceOf(alice.address);
    console.log(`   Alice ZWT balance: ${ethers.formatEther(aliceBalance)}`);
    expect(aliceBalance).to.equal(depositAmount);

    // ========== Phase 2: Derive privacy address and transfer ==========
    console.log("\n📌 Phase 2: Derive privacy address and transfer");

    const tokenId = 0n;
    const { addr20, q, privacyAddress } = derivePrivacyAddress(tokenId, SECRET);

    console.log(`   Privacy address: ${privacyAddress}`);

    const commitAmount = ethers.parseEther("500");
    await zwToken.connect(alice).transfer(privacyAddress, commitAmount);
    console.log(`   Transferred ${ethers.formatEther(commitAmount)} ZWT`);

    // ========== Phase 3: Rebuild Merkle tree ==========
    console.log("\n📌 Phase 3: Rebuild Merkle tree");

    const leafCount = await zwToken.getCommitLeafCount(0);
    const [, recipients, amounts] = await zwToken.getCommitLeaves(
      0,
      0,
      leafCount
    );

    const tree = new IncrementalMerkleTree(20);
    for (let i = 0; i < recipients.length; i++) {
      const commitment = poseidon([BigInt(recipients[i]), BigInt(amounts[i])]);
      tree.insert(commitment);
    }

    const onchainRoot = await zwToken.root();
    const localRoot = "0x" + tree.root.toString(16).padStart(64, "0");
    expect(localRoot).to.equal(onchainRoot);
    console.log("   ✅ Merkle tree rebuilt successfully");

    // ========== Phase 4: Generate ZK proof ==========
    console.log("\n📌 Phase 4: Generate ZK proof");

    const commitment = poseidon([addr20, BigInt(commitAmount)]);
    const commitmentIndex = tree.leaves.findIndex(
      (leaf) => BigInt(leaf) === commitment
    );
    const merkleProof = tree.getProof(commitmentIndex);

    const { nullifier, nullifierHex } = calculateNullifier(addr20, SECRET);
    const remintAmountValue = ethers.parseEther("300");

    const circuitInput = {
      root: tree.root,
      nullifier: nullifier,
      to: BigInt(bob.address),
      remintAmount: BigInt(remintAmountValue),
      id: tokenId,
      redeem: 0n,
      relayerFee: 0n,
      secret: SECRET,
      addr20: addr20,
      commitAmount: BigInt(commitAmount),
      q: q,
      pathElements: merkleProof.pathElements.map((e) => BigInt(e)),
      pathIndices: merkleProof.pathIndices,
    };

    console.log("   ⏳ Generating ZK proof...");
    const { proofBytes } = await generateZKProof(circuitInput);
    console.log("   ✅ ZK proof generated!");

    // ========== Phase 5: Submit remint ==========
    console.log("\n📌 Phase 5: Submit remint transaction");

    await expect(
      zwToken.remint(bob.address, 0, remintAmountValue, {
        commitment: localRoot,
        nullifiers: [nullifierHex],
        proverData: "0x",
        relayerData: "0x",
        redeem: false,
        proof: proofBytes,
      })
    ).to.emit(zwToken, "Reminted");

    const bobBalance = await zwToken.balanceOf(bob.address);
    console.log(`   Bob balance: ${ethers.formatEther(bobBalance)}`);
    expect(bobBalance).to.equal(remintAmountValue);

    // ========== Phase 6: Test replay prevention ==========
    console.log("\n📌 Phase 6: Test replay prevention");

    await expect(
      zwToken.remint(bob.address, 0, remintAmountValue, {
        commitment: localRoot,
        nullifiers: [nullifierHex],
        proverData: "0x",
        relayerData: "0x",
        redeem: false,
        proof: proofBytes,
      })
    ).to.be.revertedWithCustomError(zwToken, "NullifierUsed");

    console.log("   ✅ Replay protection verified");

    // ========== Phase 7: Bob withdraw ==========
    console.log("\n📌 Phase 7: Bob withdraw underlying token");

    await zwToken
      .connect(bob)
      .withdraw(bob.address, 0, remintAmountValue, "0x");

    const bobUnderlyingBalance = await underlying.balanceOf(bob.address);
    console.log(
      `   Bob underlying balance: ${ethers.formatEther(bobUnderlyingBalance)}`
    );
    expect(bobUnderlyingBalance).to.equal(remintAmountValue);

    console.log("\n🎉 ZWERC20 E2E Test PASSED!");
  });

  it("Test redeem=true (direct underlying token withdrawal via remint)", async function () {
    this.timeout(180000);

    console.log("\n" + "=".repeat(70));
    console.log("📝 ZWERC20 redeem=true Test");
    console.log("=".repeat(70));

    const SECRET_REDEEM = 555666777n;
    const tokenId = 0n;

    // Create new commitment
    const depositAmount = ethers.parseEther("500");
    await underlying
      .connect(alice)
      .approve(await zwToken.getAddress(), depositAmount);
    await zwToken.connect(alice).deposit(alice.address, 0, depositAmount, "0x");

    const { addr20, q, privacyAddress } = derivePrivacyAddress(
      tokenId,
      SECRET_REDEEM
    );

    const commitAmount = ethers.parseEther("400");
    await zwToken.connect(alice).transfer(privacyAddress, commitAmount);

    // Rebuild tree
    const leafCount = await zwToken.getCommitLeafCount(0);
    const [, recipients, amounts] = await zwToken.getCommitLeaves(
      0,
      0,
      leafCount
    );

    const tree = new IncrementalMerkleTree(20);
    for (let i = 0; i < recipients.length; i++) {
      const commitment = poseidon([BigInt(recipients[i]), BigInt(amounts[i])]);
      tree.insert(commitment);
    }

    const localRoot = "0x" + tree.root.toString(16).padStart(64, "0");

    // Generate proof with redeem=true
    const commitment = poseidon([addr20, BigInt(commitAmount)]);
    const commitmentIndex = tree.leaves.findIndex(
      (leaf) => BigInt(leaf) === commitment
    );
    const merkleProof = tree.getProof(commitmentIndex);
    const { nullifier, nullifierHex } = calculateNullifier(
      addr20,
      SECRET_REDEEM
    );
    const remintAmount = ethers.parseEther("200");

    const circuitInput = {
      root: tree.root,
      nullifier: nullifier,
      to: BigInt(bob.address),
      remintAmount: BigInt(remintAmount),
      id: tokenId,
      redeem: 1n, // TRUE - direct underlying withdrawal
      relayerFee: 0n,
      secret: SECRET_REDEEM,
      addr20: addr20,
      commitAmount: BigInt(commitAmount),
      q: q,
      pathElements: merkleProof.pathElements.map((e) => BigInt(e)),
      pathIndices: merkleProof.pathIndices,
    };

    console.log("   ⏳ Generating ZK proof with redeem=true...");
    const { proofBytes } = await generateZKProof(circuitInput);
    console.log("   ✅ ZK proof generated!");

    // Check Bob's underlying balance before
    const bobUnderlyingBefore = await underlying.balanceOf(bob.address);
    console.log(
      `   Bob underlying before: ${ethers.formatEther(bobUnderlyingBefore)}`
    );

    // Submit with redeem=true
    await expect(
      zwToken.remint(bob.address, 0, remintAmount, {
        commitment: localRoot,
        nullifiers: [nullifierHex],
        proverData: "0x",
        relayerData: "0x",
        redeem: true,
        proof: proofBytes,
      })
    ).to.emit(zwToken, "Reminted");

    const bobUnderlyingAfter = await underlying.balanceOf(bob.address);
    console.log(
      `   Bob underlying after: ${ethers.formatEther(bobUnderlyingAfter)}`
    );
    expect(bobUnderlyingAfter - bobUnderlyingBefore).to.equal(remintAmount);

    console.log("\n🎉 ZWERC20 redeem=true Test PASSED!");
  });
});
