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
 * ZWERC1155 E2E Test - Real ZK Proof
 */
describe("ZWERC1155 - E2E with Real ZK Proof", function () {
  let zwerc1155, underlying1155, verifier, poseidonT3;
  let deployer, alice, bob;

  const SECRET = 1155115511n;

  before(async function () {
    [deployer, alice, bob] = await ethers.getSigners();

    console.log("\n" + "=".repeat(70));
    console.log("🚀 Deploying ZWERC1155 contracts");
    console.log("=".repeat(70));

    // 1. Deploy PoseidonT3 library
    poseidonT3 = await deployPoseidonT3();
    console.log("✅ PoseidonT3:", await poseidonT3.getAddress());

    // 2. Deploy underlying ERC1155
    const ERC1155Mock = await ethers.getContractFactory("ERC1155Mock");
    underlying1155 = await ERC1155Mock.deploy("https://example.com/token/");
    await underlying1155.waitForDeployment();
    console.log("✅ ERC1155Mock:", await underlying1155.getAddress());

    // 3. Deploy Groth16Verifier
    verifier = await deployVerifier();
    console.log("✅ Groth16Verifier:", await verifier.getAddress());

    // 4. Deploy ZWERC1155 with ZWConfig struct
    const ZWERC1155 = await ethers.getContractFactory(
      "contracts/ZWERC1155.sol:ZWERC1155",
      {
        libraries: {
          PoseidonT3: await poseidonT3.getAddress(),
        },
      }
    );
    const config = createZWConfig(
      await verifier.getAddress(),
      deployer.address
    );
    zwerc1155 = await ZWERC1155.deploy(
      "ZK Wrapped Multi Token",
      "zwMT",
      await underlying1155.getAddress(),
      config
    );
    await zwerc1155.waitForDeployment();
    console.log("✅ ZWERC1155:", await zwerc1155.getAddress());

    // 5. Mint tokens to Alice
    // Token ID 1: Fungible-like (high supply)
    await underlying1155.mint(
      alice.address,
      1,
      ethers.parseEther("1000"),
      "0x"
    );
    // Token ID 2: Semi-fungible (limited supply)
    await underlying1155.mint(alice.address, 2, 100, "0x");
    // Token ID 3: NFT-like (single unit)
    await underlying1155.mint(alice.address, 3, 1, "0x");
    console.log("✅ Minted tokens to Alice (tokenIds 1, 2, 3)");
  });

  it("Full workflow: deposit → transfer → generate ZK proof → remint (fungible-like)", async function () {
    this.timeout(180000);

    console.log("\n" + "=".repeat(70));
    console.log("📝 ZWERC1155 E2E Test: Fungible Token (tokenId=1)");
    console.log("=".repeat(70));

    const tokenId = 1n;

    // ========== Phase 1: Alice deposit tokens ==========
    console.log("\n📌 Phase 1: Alice deposit ERC1155 tokens");

    const depositAmount = ethers.parseEther("500");
    await underlying1155
      .connect(alice)
      .setApprovalForAll(await zwerc1155.getAddress(), true);
    await zwerc1155
      .connect(alice)
      .deposit(alice.address, tokenId, depositAmount, "0x");

    const aliceBalance = await zwerc1155.balanceOf(alice.address, tokenId);
    console.log(
      `   Alice zw1155 balance (tokenId=${tokenId}): ${ethers.formatEther(
        aliceBalance
      )}`
    );
    expect(aliceBalance).to.equal(depositAmount);

    // ========== Phase 2: Derive privacy address and transfer ==========
    console.log("\n📌 Phase 2: Derive privacy address and transfer");

    // For ERC1155: id = tokenId
    const { addr20, q, privacyAddress } = derivePrivacyAddress(tokenId, SECRET);

    console.log(`   Privacy address for tokenId=${tokenId}: ${privacyAddress}`);

    const commitAmount = ethers.parseEther("200");
    await zwerc1155
      .connect(alice)
      .safeTransferFrom(
        alice.address,
        privacyAddress,
        tokenId,
        commitAmount,
        "0x"
      );
    console.log(
      `   Transferred ${ethers.formatEther(
        commitAmount
      )} tokens to privacy address`
    );

    // ========== Phase 3: Rebuild Merkle tree ==========
    console.log("\n📌 Phase 3: Rebuild Merkle tree");

    const leafCount = await zwerc1155.getCommitLeafCount(0);
    const [, recipients, amounts] = await zwerc1155.getCommitLeaves(
      0,
      0,
      leafCount
    );

    const tree = new IncrementalMerkleTree(20);
    for (let i = 0; i < recipients.length; i++) {
      const commitment = poseidon([BigInt(recipients[i]), BigInt(amounts[i])]);
      tree.insert(commitment);
    }

    const onchainRoot = await zwerc1155.root();
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
    const remintAmountValue = ethers.parseEther("100");

    const circuitInput = {
      root: tree.root,
      nullifier: nullifier,
      to: BigInt(bob.address),
      remintAmount: BigInt(remintAmountValue),
      id: tokenId, // ERC1155 tokenId
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
      zwerc1155.remint(bob.address, tokenId, remintAmountValue, {
        commitment: localRoot,
        nullifiers: [nullifierHex],
        proverData: "0x",
        relayerData: "0x",
        redeem: false,
        proof: proofBytes,
      })
    ).to.emit(zwerc1155, "Reminted");

    const bobBalance = await zwerc1155.balanceOf(bob.address, tokenId);
    console.log(
      `   Bob zw1155 balance (tokenId=${tokenId}): ${ethers.formatEther(
        bobBalance
      )}`
    );
    expect(bobBalance).to.equal(remintAmountValue);

    console.log("\n🎉 ZWERC1155 E2E Test PASSED!");
  });

  it("Test batch deposit and batch withdraw", async function () {
    console.log("\n" + "=".repeat(70));
    console.log("📝 ZWERC1155 Batch Operations Test");
    console.log("=".repeat(70));

    const tokenIds = [2n, 3n];
    const amounts = [50n, 1n];

    // Batch deposit
    console.log("\n📌 Batch deposit");
    await zwerc1155
      .connect(alice)
      .depositBatch(alice.address, tokenIds, amounts, "0x");

    expect(await zwerc1155.balanceOf(alice.address, 2)).to.equal(50n);
    expect(await zwerc1155.balanceOf(alice.address, 3)).to.equal(1n);
    console.log("   ✅ Batch deposit succeeded");

    // Batch withdraw
    console.log("\n📌 Batch withdraw");
    await zwerc1155
      .connect(alice)
      .withdrawBatch(alice.address, tokenIds, amounts, "0x");

    expect(await zwerc1155.balanceOf(alice.address, 2)).to.equal(0n);
    expect(await zwerc1155.balanceOf(alice.address, 3)).to.equal(0n);
    console.log("   ✅ Batch withdraw succeeded");

    console.log("\n🎉 ZWERC1155 Batch Operations Test PASSED!");
  });

  it("Test redeem=true (direct underlying token withdrawal)", async function () {
    this.timeout(180000);

    console.log("\n" + "=".repeat(70));
    console.log("📝 ZWERC1155 redeem=true Test");
    console.log("=".repeat(70));

    const SECRET_REDEEM = 2233445566n;
    const tokenId = 1n;

    // Create new commitment
    const depositAmount = ethers.parseEther("100");
    await zwerc1155
      .connect(alice)
      .deposit(alice.address, tokenId, depositAmount, "0x");

    const { addr20, q, privacyAddress } = derivePrivacyAddress(
      tokenId,
      SECRET_REDEEM
    );

    const commitAmount = ethers.parseEther("80");
    await zwerc1155
      .connect(alice)
      .safeTransferFrom(
        alice.address,
        privacyAddress,
        tokenId,
        commitAmount,
        "0x"
      );

    // Rebuild tree
    const leafCount = await zwerc1155.getCommitLeafCount(0);
    const [, recipients, amounts] = await zwerc1155.getCommitLeaves(
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
    const remintAmount = ethers.parseEther("50");

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
    const bobUnderlyingBefore = await underlying1155.balanceOf(
      bob.address,
      tokenId
    );
    console.log(
      `   Bob underlying before: ${ethers.formatEther(bobUnderlyingBefore)}`
    );

    // Submit with redeem=true
    await expect(
      zwerc1155.remint(bob.address, tokenId, remintAmount, {
        commitment: localRoot,
        nullifiers: [nullifierHex],
        proverData: "0x",
        relayerData: "0x",
        redeem: true,
        proof: proofBytes,
      })
    ).to.emit(zwerc1155, "Reminted");

    const bobUnderlyingAfter = await underlying1155.balanceOf(
      bob.address,
      tokenId
    );
    console.log(
      `   Bob underlying after: ${ethers.formatEther(bobUnderlyingAfter)}`
    );
    expect(bobUnderlyingAfter - bobUnderlyingBefore).to.equal(remintAmount);

    console.log("\n🎉 ZWERC1155 redeem=true Test PASSED!");
  });

  it("Test replay prevention", async function () {
    this.timeout(180000);

    console.log("\n" + "=".repeat(70));
    console.log("📝 ZWERC1155 Replay Prevention Test");
    console.log("=".repeat(70));

    const SECRET_REPLAY = 9988776655n;
    const tokenId = 1n;

    // Create commitment
    const depositAmount = ethers.parseEther("50");
    await zwerc1155
      .connect(alice)
      .deposit(alice.address, tokenId, depositAmount, "0x");

    const { addr20, q, privacyAddress } = derivePrivacyAddress(
      tokenId,
      SECRET_REPLAY
    );
    await zwerc1155
      .connect(alice)
      .safeTransferFrom(
        alice.address,
        privacyAddress,
        tokenId,
        depositAmount,
        "0x"
      );

    // Rebuild tree
    const leafCount = await zwerc1155.getCommitLeafCount(0);
    const [, recipients, amounts] = await zwerc1155.getCommitLeaves(
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
    const remintAmount = ethers.parseEther("25");

    const circuitInput = {
      root: tree.root,
      nullifier: nullifier,
      to: BigInt(bob.address),
      remintAmount: BigInt(remintAmount),
      id: tokenId,
      redeem: 0n,
      relayerFee: 0n,
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
      zwerc1155.remint(bob.address, tokenId, remintAmount, {
        commitment: localRoot,
        nullifiers: [nullifierHex],
        proverData: "0x",
        relayerData: "0x",
        redeem: false,
        proof: proofBytes,
      })
    ).to.emit(zwerc1155, "Reminted");

    // Second remint with same nullifier should fail
    await expect(
      zwerc1155.remint(bob.address, tokenId, remintAmount, {
        commitment: localRoot,
        nullifiers: [nullifierHex],
        proverData: "0x",
        relayerData: "0x",
        redeem: false,
        proof: proofBytes,
      })
    ).to.be.revertedWithCustomError(zwerc1155, "NullifierUsed");

    console.log("   ✅ Replay protection verified");
    console.log("\n🎉 ZWERC1155 Replay Prevention Test PASSED!");
  });

  it("Different tokenIds produce different privacy addresses", async function () {
    console.log("\n" + "=".repeat(70));
    console.log("📝 ZWERC1155 Cross-Token Isolation Test");
    console.log("=".repeat(70));

    const tokenIds = [1n, 2n, 3n, 100n, 999n];
    const privacyAddresses = [];

    for (const tokenId of tokenIds) {
      const { privacyAddress } = derivePrivacyAddress(tokenId, SECRET);
      privacyAddresses.push(privacyAddress);
      console.log(`   tokenId=${tokenId}: ${privacyAddress}`);
    }

    // Verify all addresses are unique
    const uniqueAddresses = new Set(privacyAddresses);
    expect(uniqueAddresses.size).to.equal(privacyAddresses.length);
    console.log("\n   ✅ All privacy addresses are unique!");

    console.log("\n🎉 Cross-Token Isolation Test PASSED!");
  });
});
