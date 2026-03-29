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
 * ZWETH E2E Test - Real ZK Proof
 */
describe("ZWETH - E2E with Real ZK Proof", function () {
  let zweth, verifier, poseidonT3;
  let deployer, alice, bob;

  const SECRET = 987654321n;

  before(async function () {
    [deployer, alice, bob] = await ethers.getSigners();

    console.log("\n" + "=".repeat(70));
    console.log("🚀 Deploying ZWETH contracts");
    console.log("=".repeat(70));

    // 1. Deploy PoseidonT3 library
    poseidonT3 = await deployPoseidonT3();
    console.log("✅ PoseidonT3:", await poseidonT3.getAddress());

    // 2. Deploy Groth16Verifier
    verifier = await deployVerifier();
    console.log("✅ Groth16Verifier:", await verifier.getAddress());

    // 3. Deploy ZWETH with ZWConfig struct
    const ZWETH = await ethers.getContractFactory("contracts/ZWETH.sol:ZWETH", {
      libraries: {
        PoseidonT3: await poseidonT3.getAddress(),
      },
    });
    const config = createZWConfig(
      await verifier.getAddress(),
      deployer.address
    );
    zweth = await ZWETH.deploy("ZK Wrapped ETH", "zwETH", config);
    await zweth.waitForDeployment();
    console.log("✅ ZWETH:", await zweth.getAddress());
  });

  it("Full workflow: deposit ETH → transfer → generate ZK proof → remint", async function () {
    this.timeout(180000);

    console.log("\n" + "=".repeat(70));
    console.log("📝 ZWETH E2E Test: Real ZK Proof");
    console.log("=".repeat(70));

    // ========== Phase 1: Alice deposit ETH ==========
    console.log("\n📌 Phase 1: Alice deposit ETH");

    const depositAmount = ethers.parseEther("5");
    await zweth.connect(alice).deposit(alice.address, 0, depositAmount, "0x", {
      value: depositAmount,
    });

    const aliceBalance = await zweth.balanceOf(alice.address);
    console.log(`   Alice zwETH balance: ${ethers.formatEther(aliceBalance)}`);
    expect(aliceBalance).to.equal(depositAmount);

    // ========== Phase 2: Derive privacy address and transfer ==========
    console.log("\n📌 Phase 2: Derive privacy address and transfer");

    const tokenId = 0n;
    const { addr20, q, privacyAddress } = derivePrivacyAddress(tokenId, SECRET);

    console.log(`   Privacy address: ${privacyAddress}`);

    const commitAmount = ethers.parseEther("3");
    await zweth.connect(alice).transfer(privacyAddress, commitAmount);
    console.log(`   Transferred ${ethers.formatEther(commitAmount)} zwETH`);

    // ========== Phase 3: Rebuild Merkle tree ==========
    console.log("\n📌 Phase 3: Rebuild Merkle tree");

    const leafCount = await zweth.getCommitLeafCount(0);
    const [, recipients, amounts] = await zweth.getCommitLeaves(
      0,
      0,
      leafCount
    );

    const tree = new IncrementalMerkleTree(20);
    for (let i = 0; i < recipients.length; i++) {
      const commitment = poseidon([BigInt(recipients[i]), BigInt(amounts[i])]);
      tree.insert(commitment);
    }

    const onchainRoot = await zweth.root();
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
    const remintAmountValue = ethers.parseEther("2");

    const circuitInput = {
      root: tree.root,
      nullifier: nullifier,
      to: BigInt(bob.address),
      remintAmount: BigInt(remintAmountValue),
      id: tokenId,
      redeem: 0n,
      relayerFee: 0n,
      revealedAddr: 0n,
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
      zweth.remint(bob.address, 0, remintAmountValue, {
        commitment: localRoot,
        nullifiers: [nullifierHex],
        proverData: "0x",
        relayerData: "0x",
        redeem: false,
        proof: proofBytes,
      })
    ).to.emit(zweth, "Reminted");

    const bobBalance = await zweth.balanceOf(bob.address);
    console.log(`   Bob zwETH balance: ${ethers.formatEther(bobBalance)}`);
    expect(bobBalance).to.equal(remintAmountValue);

    // ========== Phase 6: Bob withdraw ETH ==========
    console.log("\n📌 Phase 6: Bob withdraw ETH");

    const bobEthBefore = await ethers.provider.getBalance(bob.address);
    const withdrawTx = await zweth
      .connect(bob)
      .withdraw(bob.address, 0, remintAmountValue, "0x");
    const receipt = await withdrawTx.wait();
    const gasUsed = receipt.gasUsed * receipt.gasPrice;
    const bobEthAfter = await ethers.provider.getBalance(bob.address);

    const ethReceived = bobEthAfter - bobEthBefore + gasUsed;
    console.log(`   Bob received ETH: ${ethers.formatEther(ethReceived)}`);
    expect(ethReceived).to.equal(remintAmountValue);

    console.log("\n🎉 ZWETH E2E Test PASSED!");
  });

  it("Test redeem=true (direct ETH withdrawal via remint)", async function () {
    this.timeout(180000);

    console.log("\n" + "=".repeat(70));
    console.log("📝 ZWETH redeem=true Test");
    console.log("=".repeat(70));

    const SECRET_REDEEM = 111222333n;
    const tokenId = 0n;

    // Create new commitment
    const depositAmount = ethers.parseEther("2");
    await zweth.connect(alice).deposit(alice.address, 0, depositAmount, "0x", {
      value: depositAmount,
    });

    const { addr20, q, privacyAddress } = derivePrivacyAddress(
      tokenId,
      SECRET_REDEEM
    );

    const commitAmount = ethers.parseEther("1.5");
    await zweth.connect(alice).transfer(privacyAddress, commitAmount);

    // Rebuild tree
    const leafCount = await zweth.getCommitLeafCount(0);
    const [, recipients, amounts] = await zweth.getCommitLeaves(
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
    const remintAmount = ethers.parseEther("1");

    const circuitInput = {
      root: tree.root,
      nullifier: nullifier,
      to: BigInt(bob.address),
      remintAmount: BigInt(remintAmount),
      id: tokenId,
      redeem: 1n, // TRUE - direct ETH withdrawal
      relayerFee: 0n,
      revealedAddr: 0n,
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

    // Submit with redeem=true - should receive ETH directly
    const bobEthBefore = await ethers.provider.getBalance(bob.address);

    await expect(
      zweth.remint(bob.address, 0, remintAmount, {
        commitment: localRoot,
        nullifiers: [nullifierHex],
        proverData: "0x",
        relayerData: "0x",
        redeem: true,
        proof: proofBytes,
      })
    ).to.emit(zweth, "Reminted");

    const bobEthAfter = await ethers.provider.getBalance(bob.address);
    const ethReceived = bobEthAfter - bobEthBefore;
    console.log(
      `   Bob received ETH directly: ${ethers.formatEther(ethReceived)}`
    );
    expect(ethReceived).to.equal(remintAmount);

    console.log("\n🎉 ZWETH redeem=true Test PASSED!");
  });

  it("Test replay prevention", async function () {
    this.timeout(180000);

    console.log("\n" + "=".repeat(70));
    console.log("📝 ZWETH Replay Prevention Test");
    console.log("=".repeat(70));

    const SECRET_REPLAY = 444555666n;
    const tokenId = 0n;

    // Create commitment
    const depositAmount = ethers.parseEther("1");
    await zweth.connect(alice).deposit(alice.address, 0, depositAmount, "0x", {
      value: depositAmount,
    });

    const { addr20, q, privacyAddress } = derivePrivacyAddress(
      tokenId,
      SECRET_REPLAY
    );
    await zweth.connect(alice).transfer(privacyAddress, depositAmount);

    // Rebuild tree
    const leafCount = await zweth.getCommitLeafCount(0);
    const [, recipients, amounts] = await zweth.getCommitLeaves(
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

    // Generate proof
    const commitment = poseidon([addr20, BigInt(depositAmount)]);
    const commitmentIndex = tree.leaves.findIndex(
      (leaf) => BigInt(leaf) === commitment
    );
    const merkleProof = tree.getProof(commitmentIndex);
    const { nullifier, nullifierHex } = calculateNullifier(
      addr20,
      SECRET_REPLAY
    );
    const remintAmount = ethers.parseEther("0.5");

    const circuitInput = {
      root: tree.root,
      nullifier: nullifier,
      to: BigInt(bob.address),
      remintAmount: BigInt(remintAmount),
      id: tokenId,
      redeem: 0n,
      relayerFee: 0n,
      revealedAddr: 0n,
      secret: SECRET_REPLAY,
      addr20: addr20,
      commitAmount: BigInt(depositAmount),
      q: q,
      pathElements: merkleProof.pathElements.map((e) => BigInt(e)),
      pathIndices: merkleProof.pathIndices,
    };

    const { proofBytes } = await generateZKProof(circuitInput);

    // First remint should succeed
    await expect(
      zweth.remint(bob.address, 0, remintAmount, {
        commitment: localRoot,
        nullifiers: [nullifierHex],
        proverData: "0x",
        relayerData: "0x",
        redeem: false,
        proof: proofBytes,
      })
    ).to.emit(zweth, "Reminted");

    // Second remint with same nullifier should fail
    await expect(
      zweth.remint(bob.address, 0, remintAmount, {
        commitment: localRoot,
        nullifiers: [nullifierHex],
        proverData: "0x",
        relayerData: "0x",
        redeem: false,
        proof: proofBytes,
      })
    ).to.be.revertedWithCustomError(zweth, "NullifierUsed");

    console.log("   ✅ Replay protection verified");
    console.log("\n🎉 ZWETH Replay Prevention Test PASSED!");
  });
});

