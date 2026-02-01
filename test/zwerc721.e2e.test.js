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
 * ZWERC721 E2E Test - Real ZK Proof
 */
describe("ZWERC721 - E2E with Real ZK Proof", function () {
  let zwerc721, underlying721, verifier, poseidonT3;
  let deployer, alice, bob;

  const SECRET = 721721721n;

  before(async function () {
    [deployer, alice, bob] = await ethers.getSigners();

    console.log("\n" + "=".repeat(70));
    console.log("🚀 Deploying ZWERC721 contracts");
    console.log("=".repeat(70));

    // 1. Deploy PoseidonT3 library
    poseidonT3 = await deployPoseidonT3();
    console.log("✅ PoseidonT3:", await poseidonT3.getAddress());

    // 2. Deploy underlying ERC721
    const ERC721Mock = await ethers.getContractFactory("ERC721Mock");
    underlying721 = await ERC721Mock.deploy("Mock NFT", "MNFT");
    await underlying721.waitForDeployment();
    console.log("✅ ERC721Mock:", await underlying721.getAddress());

    // 3. Deploy Groth16Verifier
    verifier = await deployVerifier();
    console.log("✅ Groth16Verifier:", await verifier.getAddress());

    // 4. Deploy ZWERC721 with ZWConfig struct
    const ZWERC721 = await ethers.getContractFactory(
      "contracts/ZWERC721.sol:ZWERC721",
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
    zwerc721 = await ZWERC721.deploy(
      "ZK Wrapped NFT",
      "zwNFT",
      await underlying721.getAddress(),
      config
    );
    await zwerc721.waitForDeployment();
    console.log("✅ ZWERC721:", await zwerc721.getAddress());

    // 5. Mint NFTs to Alice
    await underlying721.mint(alice.address); // tokenId = 0
    await underlying721.mint(alice.address); // tokenId = 1
    await underlying721.mint(alice.address); // tokenId = 2
    await underlying721.mint(alice.address); // tokenId = 3
    await underlying721.mint(alice.address); // tokenId = 4
    console.log("✅ Minted 5 NFTs to Alice (tokenIds 0, 1, 2, 3, 4)");
  });

  it("Full workflow: deposit NFT → transfer → generate ZK proof → remint", async function () {
    this.timeout(180000);

    console.log("\n" + "=".repeat(70));
    console.log("📝 ZWERC721 E2E Test: Real ZK Proof");
    console.log("=".repeat(70));

    const nftTokenId = 0n; // NFT tokenId to wrap

    // ========== Phase 1: Alice deposit NFT ==========
    console.log("\n📌 Phase 1: Alice deposit NFT (tokenId=0)");

    await underlying721
      .connect(alice)
      .approve(await zwerc721.getAddress(), nftTokenId);
    await zwerc721.connect(alice).deposit(alice.address, nftTokenId, 1, "0x");

    expect(await zwerc721.ownerOf(nftTokenId)).to.equal(alice.address);
    console.log(`   Alice owns zwNFT #${nftTokenId}`);

    // ========== Phase 2: Derive privacy address and transfer NFT ==========
    console.log("\n📌 Phase 2: Derive privacy address and transfer NFT");

    // For NFTs, id = tokenId (not 0)
    const { addr20, q, privacyAddress } = derivePrivacyAddress(
      nftTokenId,
      SECRET
    );

    console.log(
      `   Privacy address for tokenId=${nftTokenId}: ${privacyAddress}`
    );

    // Transfer NFT to privacy address
    await zwerc721
      .connect(alice)
      .transferFrom(alice.address, privacyAddress, nftTokenId);
    expect(await zwerc721.ownerOf(nftTokenId)).to.equal(privacyAddress);
    console.log(`   Transferred NFT #${nftTokenId} to privacy address`);

    // ========== Phase 3: Rebuild Merkle tree ==========
    console.log("\n📌 Phase 3: Rebuild Merkle tree");

    const leafCount = await zwerc721.getCommitLeafCount(0);
    const [, recipients, amounts] = await zwerc721.getCommitLeaves(
      0,
      0,
      leafCount
    );

    const tree = new IncrementalMerkleTree(20);
    for (let i = 0; i < recipients.length; i++) {
      const commitment = poseidon([BigInt(recipients[i]), BigInt(amounts[i])]);
      tree.insert(commitment);
    }

    const onchainRoot = await zwerc721.root();
    const localRoot = "0x" + tree.root.toString(16).padStart(64, "0");
    expect(localRoot).to.equal(onchainRoot);
    console.log("   ✅ Merkle tree rebuilt successfully");

    // ========== Phase 4: Generate ZK proof ==========
    console.log("\n📌 Phase 4: Generate ZK proof");

    // For NFTs: amount = 1
    const commitment = poseidon([addr20, 1n]);
    const commitmentIndex = tree.leaves.findIndex(
      (leaf) => BigInt(leaf) === commitment
    );
    const merkleProof = tree.getProof(commitmentIndex);

    const { nullifier, nullifierHex } = calculateNullifier(addr20, SECRET);

    const circuitInput = {
      root: tree.root,
      nullifier: nullifier,
      to: BigInt(bob.address),
      remintAmount: 1n, // Always 1 for NFTs
      id: nftTokenId, // NFT tokenId
      redeem: 0n,
      relayerFee: 0n,
      secret: SECRET,
      addr20: addr20,
      commitAmount: 1n, // Always 1 for NFTs
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
      zwerc721.remint(bob.address, nftTokenId, 1, {
        commitment: localRoot,
        nullifiers: [nullifierHex],
        proverData: "0x",
        relayerData: "0x",
        redeem: false, // Transfer ZW token to Bob
        proof: proofBytes,
      })
    ).to.emit(zwerc721, "Reminted");

    expect(await zwerc721.ownerOf(nftTokenId)).to.equal(bob.address);
    console.log(`   ✅ Bob now owns zwNFT #${nftTokenId}`);

    console.log("\n🎉 ZWERC721 E2E Test PASSED!");
  });

  it("Test deposit and withdraw NFT", async function () {
    console.log("\n" + "=".repeat(70));
    console.log("📝 ZWERC721 Deposit/Withdraw Test");
    console.log("=".repeat(70));

    const nftTokenId = 1n;

    // Deposit
    await underlying721
      .connect(alice)
      .approve(await zwerc721.getAddress(), nftTokenId);
    await zwerc721.connect(alice).deposit(alice.address, nftTokenId, 1, "0x");

    expect(await zwerc721.ownerOf(nftTokenId)).to.equal(alice.address);
    expect(await underlying721.ownerOf(nftTokenId)).to.equal(
      await zwerc721.getAddress()
    );
    console.log(
      "   ✅ NFT deposited - Alice owns zwNFT, contract holds underlying"
    );

    // Withdraw
    await zwerc721.connect(alice).withdraw(alice.address, nftTokenId, 1, "0x");

    expect(await underlying721.ownerOf(nftTokenId)).to.equal(alice.address);
    console.log("   ✅ NFT withdrawn - Alice owns underlying NFT");

    console.log("\n🎉 ZWERC721 Deposit/Withdraw Test PASSED!");
  });

  it("Test redeem=true (direct NFT withdrawal via remint)", async function () {
    this.timeout(180000);

    console.log("\n" + "=".repeat(70));
    console.log("📝 ZWERC721 redeem=true Test");
    console.log("=".repeat(70));

    const SECRET_REDEEM = 888999000n;
    const nftTokenId = 2n;

    // Deposit NFT
    await underlying721
      .connect(alice)
      .approve(await zwerc721.getAddress(), nftTokenId);
    await zwerc721.connect(alice).deposit(alice.address, nftTokenId, 1, "0x");

    // Transfer to privacy address
    const { addr20, q, privacyAddress } = derivePrivacyAddress(
      nftTokenId,
      SECRET_REDEEM
    );
    await zwerc721
      .connect(alice)
      .transferFrom(alice.address, privacyAddress, nftTokenId);

    // Rebuild tree
    const leafCount = await zwerc721.getCommitLeafCount(0);
    const [, recipients, amounts] = await zwerc721.getCommitLeaves(
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
    const commitment = poseidon([addr20, 1n]);
    const commitmentIndex = tree.leaves.findIndex(
      (leaf) => BigInt(leaf) === commitment
    );
    const merkleProof = tree.getProof(commitmentIndex);
    const { nullifier, nullifierHex } = calculateNullifier(
      addr20,
      SECRET_REDEEM
    );

    const circuitInput = {
      root: tree.root,
      nullifier: nullifier,
      to: BigInt(bob.address),
      remintAmount: 1n,
      id: nftTokenId,
      redeem: 1n, // TRUE - direct underlying NFT withdrawal
      relayerFee: 0n,
      secret: SECRET_REDEEM,
      addr20: addr20,
      commitAmount: 1n,
      q: q,
      pathElements: merkleProof.pathElements.map((e) => BigInt(e)),
      pathIndices: merkleProof.pathIndices,
    };

    console.log("   ⏳ Generating ZK proof with redeem=true...");
    const { proofBytes } = await generateZKProof(circuitInput);
    console.log("   ✅ ZK proof generated!");

    // Submit with redeem=true
    await expect(
      zwerc721.remint(bob.address, nftTokenId, 1, {
        commitment: localRoot,
        nullifiers: [nullifierHex],
        proverData: "0x",
        relayerData: "0x",
        redeem: true,
        proof: proofBytes,
      })
    ).to.emit(zwerc721, "Reminted");

    expect(await underlying721.ownerOf(nftTokenId)).to.equal(bob.address);
    console.log(`   ✅ Bob received underlying NFT #${nftTokenId}`);

    console.log("\n🎉 ZWERC721 redeem=true Test PASSED!");
  });

  it("Different tokenIds produce different privacy addresses", async function () {
    console.log("\n" + "=".repeat(70));
    console.log("📝 ZWERC721 Cross-Token Isolation Test");
    console.log("=".repeat(70));

    const tokenIds = [0n, 1n, 2n, 100n];
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

  it("Consecutive remint: A → B → C with different secrets", async function () {
    this.timeout(300000);

    console.log("\n" + "=".repeat(70));
    console.log("📝 ZWERC721 Consecutive Remint Test (A → B → C)");
    console.log("=".repeat(70));

    const nftTokenId = 3n;
    const SECRET_A = 111111111n;
    const SECRET_B = 222222222n;
    const SECRET_C = 333333333n;

    // ========== Phase 1: Alice deposits NFT ==========
    console.log("\n📌 Phase 1: Alice deposits NFT (tokenId=3)");

    await underlying721
      .connect(alice)
      .approve(await zwerc721.getAddress(), nftTokenId);
    await zwerc721.connect(alice).deposit(alice.address, nftTokenId, 1, "0x");
    expect(await zwerc721.ownerOf(nftTokenId)).to.equal(alice.address);
    console.log("   ✅ Alice deposited NFT and owns zwNFT #3");

    // ========== Phase 2: Alice transfers to privacyAddress_A ==========
    console.log("\n📌 Phase 2: Alice transfers NFT to privacyAddress_A");

    const { addr20: addr20_A, q: q_A, privacyAddress: privacyAddress_A } = 
      derivePrivacyAddress(nftTokenId, SECRET_A);
    
    await zwerc721
      .connect(alice)
      .transferFrom(alice.address, privacyAddress_A, nftTokenId);
    expect(await zwerc721.ownerOf(nftTokenId)).to.equal(privacyAddress_A);
    console.log(`   ✅ NFT transferred to privacyAddress_A: ${privacyAddress_A}`);

    // ========== Phase 3: First remint (A → B) ==========
    console.log("\n📌 Phase 3: First remint (privacyAddress_A → privacyAddress_B)");

    // Derive privacyAddress_B for the next holder
    const { addr20: addr20_B, q: q_B, privacyAddress: privacyAddress_B } = 
      derivePrivacyAddress(nftTokenId, SECRET_B);
    console.log(`   Target privacyAddress_B: ${privacyAddress_B}`);

    // Rebuild Merkle tree
    let leafCount = await zwerc721.getCommitLeafCount(0);
    let [, recipients, amounts] = await zwerc721.getCommitLeaves(0, 0, leafCount);

    let tree = new IncrementalMerkleTree(20);
    for (let i = 0; i < recipients.length; i++) {
      const commitment = poseidon([BigInt(recipients[i]), BigInt(amounts[i])]);
      tree.insert(commitment);
    }

    let localRoot = "0x" + tree.root.toString(16).padStart(64, "0");
    expect(localRoot).to.equal(await zwerc721.root());

    // Generate proof for first remint
    let commitment_A = poseidon([addr20_A, 1n]);
    let commitmentIndex = tree.leaves.findIndex(
      (leaf) => BigInt(leaf) === commitment_A
    );
    expect(commitmentIndex).to.be.gte(0, "Commitment A not found in tree");
    
    let merkleProof = tree.getProof(commitmentIndex);
    const { nullifier: nullifier_A, nullifierHex: nullifierHex_A } = 
      calculateNullifier(addr20_A, SECRET_A);

    let circuitInput = {
      root: tree.root,
      nullifier: nullifier_A,
      to: BigInt(privacyAddress_B), // Remint to privacyAddress_B
      remintAmount: 1n,
      id: nftTokenId,
      redeem: 0n,
      relayerFee: 0n,
      secret: SECRET_A,
      addr20: addr20_A,
      commitAmount: 1n,
      q: q_A,
      pathElements: merkleProof.pathElements.map((e) => BigInt(e)),
      pathIndices: merkleProof.pathIndices,
    };

    console.log("   ⏳ Generating ZK proof for first remint...");
    let { proofBytes } = await generateZKProof(circuitInput);
    console.log("   ✅ ZK proof generated!");

    // Submit first remint
    await expect(
      zwerc721.remint(privacyAddress_B, nftTokenId, 1, {
        commitment: localRoot,
        nullifiers: [nullifierHex_A],
        proverData: "0x",
        relayerData: "0x",
        redeem: false,
        proof: proofBytes,
      })
    ).to.emit(zwerc721, "Reminted");

    expect(await zwerc721.ownerOf(nftTokenId)).to.equal(privacyAddress_B);
    console.log(`   ✅ First remint successful! NFT now at privacyAddress_B`);

    // Verify nullifier_A is consumed
    expect(await zwerc721.nullifierUsed(nullifierHex_A)).to.be.true;
    console.log("   ✅ Nullifier A consumed (prevents double-spend)");

    // ========== Phase 4: Second remint (B → C) ==========
    console.log("\n📌 Phase 4: Second remint (privacyAddress_B → privacyAddress_C)");

    // Derive privacyAddress_C for the final holder
    const { addr20: addr20_C, q: q_C, privacyAddress: privacyAddress_C } = 
      derivePrivacyAddress(nftTokenId, SECRET_C);
    console.log(`   Target privacyAddress_C: ${privacyAddress_C}`);

    // Rebuild Merkle tree (now has new commitment for privacyAddress_B)
    leafCount = await zwerc721.getCommitLeafCount(0);
    [, recipients, amounts] = await zwerc721.getCommitLeaves(0, 0, leafCount);

    tree = new IncrementalMerkleTree(20);
    for (let i = 0; i < recipients.length; i++) {
      const commitment = poseidon([BigInt(recipients[i]), BigInt(amounts[i])]);
      tree.insert(commitment);
    }

    localRoot = "0x" + tree.root.toString(16).padStart(64, "0");
    expect(localRoot).to.equal(await zwerc721.root());

    // Generate proof for second remint
    let commitment_B = poseidon([addr20_B, 1n]);
    commitmentIndex = tree.leaves.findIndex(
      (leaf) => BigInt(leaf) === commitment_B
    );
    expect(commitmentIndex).to.be.gte(0, "Commitment B not found in tree");

    merkleProof = tree.getProof(commitmentIndex);
    const { nullifier: nullifier_B, nullifierHex: nullifierHex_B } = 
      calculateNullifier(addr20_B, SECRET_B);

    circuitInput = {
      root: tree.root,
      nullifier: nullifier_B,
      to: BigInt(privacyAddress_C), // Remint to privacyAddress_C
      remintAmount: 1n,
      id: nftTokenId,
      redeem: 0n,
      relayerFee: 0n,
      secret: SECRET_B,
      addr20: addr20_B,
      commitAmount: 1n,
      q: q_B,
      pathElements: merkleProof.pathElements.map((e) => BigInt(e)),
      pathIndices: merkleProof.pathIndices,
    };

    console.log("   ⏳ Generating ZK proof for second remint...");
    ({ proofBytes } = await generateZKProof(circuitInput));
    console.log("   ✅ ZK proof generated!");

    // Submit second remint
    await expect(
      zwerc721.remint(privacyAddress_C, nftTokenId, 1, {
        commitment: localRoot,
        nullifiers: [nullifierHex_B],
        proverData: "0x",
        relayerData: "0x",
        redeem: false,
        proof: proofBytes,
      })
    ).to.emit(zwerc721, "Reminted");

    expect(await zwerc721.ownerOf(nftTokenId)).to.equal(privacyAddress_C);
    console.log(`   ✅ Second remint successful! NFT now at privacyAddress_C`);

    // Verify nullifier_B is consumed
    expect(await zwerc721.nullifierUsed(nullifierHex_B)).to.be.true;
    console.log("   ✅ Nullifier B consumed (prevents double-spend)");

    // ========== Phase 5: Third remint with redeem=true (C → Bob's real address) ==========
    console.log("\n📌 Phase 5: Third remint with redeem=true (privacyAddress_C → Bob)");

    // Rebuild Merkle tree (now has new commitment for privacyAddress_C)
    leafCount = await zwerc721.getCommitLeafCount(0);
    [, recipients, amounts] = await zwerc721.getCommitLeaves(0, 0, leafCount);

    tree = new IncrementalMerkleTree(20);
    for (let i = 0; i < recipients.length; i++) {
      const commitment = poseidon([BigInt(recipients[i]), BigInt(amounts[i])]);
      tree.insert(commitment);
    }

    localRoot = "0x" + tree.root.toString(16).padStart(64, "0");
    expect(localRoot).to.equal(await zwerc721.root());

    // Generate proof for final remint with redeem=true
    let commitment_C = poseidon([addr20_C, 1n]);
    commitmentIndex = tree.leaves.findIndex(
      (leaf) => BigInt(leaf) === commitment_C
    );
    expect(commitmentIndex).to.be.gte(0, "Commitment C not found in tree");

    merkleProof = tree.getProof(commitmentIndex);
    const { nullifier: nullifier_C, nullifierHex: nullifierHex_C } = 
      calculateNullifier(addr20_C, SECRET_C);

    circuitInput = {
      root: tree.root,
      nullifier: nullifier_C,
      to: BigInt(bob.address), // Redeem to Bob's real address
      remintAmount: 1n,
      id: nftTokenId,
      redeem: 1n, // Redeem underlying NFT
      relayerFee: 0n,
      secret: SECRET_C,
      addr20: addr20_C,
      commitAmount: 1n,
      q: q_C,
      pathElements: merkleProof.pathElements.map((e) => BigInt(e)),
      pathIndices: merkleProof.pathIndices,
    };

    console.log("   ⏳ Generating ZK proof for final remint (redeem=true)...");
    ({ proofBytes } = await generateZKProof(circuitInput));
    console.log("   ✅ ZK proof generated!");

    // Submit final remint with redeem=true
    await expect(
      zwerc721.remint(bob.address, nftTokenId, 1, {
        commitment: localRoot,
        nullifiers: [nullifierHex_C],
        proverData: "0x",
        relayerData: "0x",
        redeem: true, // Withdraw underlying NFT
        proof: proofBytes,
      })
    ).to.emit(zwerc721, "Reminted");

    // Verify Bob received the underlying NFT
    expect(await underlying721.ownerOf(nftTokenId)).to.equal(bob.address);
    console.log(`   ✅ Final remint (redeem) successful! Bob received underlying NFT #${nftTokenId}`);

    // Verify nullifier_C is consumed
    expect(await zwerc721.nullifierUsed(nullifierHex_C)).to.be.true;
    console.log("   ✅ Nullifier C consumed (prevents double-spend)");

    // Summary
    console.log("\n" + "=".repeat(70));
    console.log("📊 Consecutive Remint Summary:");
    console.log("   1. Alice → privacyAddress_A (transfer)");
    console.log("   2. privacyAddress_A → privacyAddress_B (remint with SECRET_A)");
    console.log("   3. privacyAddress_B → privacyAddress_C (remint with SECRET_B)");
    console.log("   4. privacyAddress_C → Bob (remint+redeem with SECRET_C)");
    console.log("=".repeat(70));

    console.log("\n🎉 Consecutive Remint Test PASSED!");
  });

  it("Same person consecutive remint: Alice uses multiple secrets", async function () {
    this.timeout(300000);

    console.log("\n" + "=".repeat(70));
    console.log("📝 ZWERC721 Same Person Consecutive Remint Test");
    console.log("   (Alice remints 3 times using different secrets)");
    console.log("=".repeat(70));

    const nftTokenId = 4n;
    
    // Alice's multiple secrets
    const ALICE_SECRET_1 = 100000001n;
    const ALICE_SECRET_2 = 100000002n;
    const ALICE_SECRET_3 = 100000003n;

    // ========== Phase 1: Alice deposits NFT ==========
    console.log("\n📌 Phase 1: Alice deposits NFT (tokenId=4)");

    await underlying721
      .connect(alice)
      .approve(await zwerc721.getAddress(), nftTokenId);
    await zwerc721.connect(alice).deposit(alice.address, nftTokenId, 1, "0x");
    expect(await zwerc721.ownerOf(nftTokenId)).to.equal(alice.address);
    console.log("   ✅ Alice deposited NFT and owns zwNFT #4");

    // ========== Phase 2: Alice transfers to her first privacy address ==========
    console.log("\n📌 Phase 2: Alice transfers to her privacyAddress_1");

    const { addr20: addr20_1, q: q_1, privacyAddress: privacyAddress_1 } = 
      derivePrivacyAddress(nftTokenId, ALICE_SECRET_1);
    
    await zwerc721
      .connect(alice)
      .transferFrom(alice.address, privacyAddress_1, nftTokenId);
    expect(await zwerc721.ownerOf(nftTokenId)).to.equal(privacyAddress_1);
    console.log(`   ✅ NFT transferred to Alice's privacyAddress_1: ${privacyAddress_1}`);

    // ========== Phase 3: First remint (Alice's addr1 → Alice's addr2) ==========
    console.log("\n📌 Phase 3: Alice remints to her privacyAddress_2");

    const { addr20: addr20_2, q: q_2, privacyAddress: privacyAddress_2 } = 
      derivePrivacyAddress(nftTokenId, ALICE_SECRET_2);
    console.log(`   Target privacyAddress_2: ${privacyAddress_2}`);

    // Rebuild Merkle tree
    let leafCount = await zwerc721.getCommitLeafCount(0);
    let [, recipients, amounts] = await zwerc721.getCommitLeaves(0, 0, leafCount);

    let tree = new IncrementalMerkleTree(20);
    for (let i = 0; i < recipients.length; i++) {
      const commitment = poseidon([BigInt(recipients[i]), BigInt(amounts[i])]);
      tree.insert(commitment);
    }

    let localRoot = "0x" + tree.root.toString(16).padStart(64, "0");

    // Generate proof
    let commitment_1 = poseidon([addr20_1, 1n]);
    let commitmentIndex = tree.leaves.findIndex(
      (leaf) => BigInt(leaf) === commitment_1
    );
    expect(commitmentIndex).to.be.gte(0);
    
    let merkleProof = tree.getProof(commitmentIndex);
    const { nullifier: nullifier_1, nullifierHex: nullifierHex_1 } = 
      calculateNullifier(addr20_1, ALICE_SECRET_1);

    let circuitInput = {
      root: tree.root,
      nullifier: nullifier_1,
      to: BigInt(privacyAddress_2),
      remintAmount: 1n,
      id: nftTokenId,
      redeem: 0n,
      relayerFee: 0n,
      secret: ALICE_SECRET_1,
      addr20: addr20_1,
      commitAmount: 1n,
      q: q_1,
      pathElements: merkleProof.pathElements.map((e) => BigInt(e)),
      pathIndices: merkleProof.pathIndices,
    };

    console.log("   ⏳ Generating ZK proof...");
    let { proofBytes } = await generateZKProof(circuitInput);
    console.log("   ✅ ZK proof generated!");

    await expect(
      zwerc721.remint(privacyAddress_2, nftTokenId, 1, {
        commitment: localRoot,
        nullifiers: [nullifierHex_1],
        proverData: "0x",
        relayerData: "0x",
        redeem: false,
        proof: proofBytes,
      })
    ).to.emit(zwerc721, "Reminted");

    expect(await zwerc721.ownerOf(nftTokenId)).to.equal(privacyAddress_2);
    console.log(`   ✅ First remint done! NFT at Alice's privacyAddress_2`);

    // ========== Phase 4: Second remint (Alice's addr2 → Alice's addr3) ==========
    console.log("\n📌 Phase 4: Alice remints to her privacyAddress_3");

    const { addr20: addr20_3, q: q_3, privacyAddress: privacyAddress_3 } = 
      derivePrivacyAddress(nftTokenId, ALICE_SECRET_3);
    console.log(`   Target privacyAddress_3: ${privacyAddress_3}`);

    // Rebuild Merkle tree
    leafCount = await zwerc721.getCommitLeafCount(0);
    [, recipients, amounts] = await zwerc721.getCommitLeaves(0, 0, leafCount);

    tree = new IncrementalMerkleTree(20);
    for (let i = 0; i < recipients.length; i++) {
      const commitment = poseidon([BigInt(recipients[i]), BigInt(amounts[i])]);
      tree.insert(commitment);
    }

    localRoot = "0x" + tree.root.toString(16).padStart(64, "0");

    // Generate proof
    let commitment_2 = poseidon([addr20_2, 1n]);
    commitmentIndex = tree.leaves.findIndex(
      (leaf) => BigInt(leaf) === commitment_2
    );
    expect(commitmentIndex).to.be.gte(0);

    merkleProof = tree.getProof(commitmentIndex);
    const { nullifier: nullifier_2, nullifierHex: nullifierHex_2 } = 
      calculateNullifier(addr20_2, ALICE_SECRET_2);

    circuitInput = {
      root: tree.root,
      nullifier: nullifier_2,
      to: BigInt(privacyAddress_3),
      remintAmount: 1n,
      id: nftTokenId,
      redeem: 0n,
      relayerFee: 0n,
      secret: ALICE_SECRET_2,
      addr20: addr20_2,
      commitAmount: 1n,
      q: q_2,
      pathElements: merkleProof.pathElements.map((e) => BigInt(e)),
      pathIndices: merkleProof.pathIndices,
    };

    console.log("   ⏳ Generating ZK proof...");
    ({ proofBytes } = await generateZKProof(circuitInput));
    console.log("   ✅ ZK proof generated!");

    await expect(
      zwerc721.remint(privacyAddress_3, nftTokenId, 1, {
        commitment: localRoot,
        nullifiers: [nullifierHex_2],
        proverData: "0x",
        relayerData: "0x",
        redeem: false,
        proof: proofBytes,
      })
    ).to.emit(zwerc721, "Reminted");

    expect(await zwerc721.ownerOf(nftTokenId)).to.equal(privacyAddress_3);
    console.log(`   ✅ Second remint done! NFT at Alice's privacyAddress_3`);

    // ========== Phase 5: Final remint with redeem (Alice withdraws to her real address) ==========
    console.log("\n📌 Phase 5: Alice redeems to her real address");

    // Rebuild Merkle tree
    leafCount = await zwerc721.getCommitLeafCount(0);
    [, recipients, amounts] = await zwerc721.getCommitLeaves(0, 0, leafCount);

    tree = new IncrementalMerkleTree(20);
    for (let i = 0; i < recipients.length; i++) {
      const commitment = poseidon([BigInt(recipients[i]), BigInt(amounts[i])]);
      tree.insert(commitment);
    }

    localRoot = "0x" + tree.root.toString(16).padStart(64, "0");

    // Generate proof
    let commitment_3 = poseidon([addr20_3, 1n]);
    commitmentIndex = tree.leaves.findIndex(
      (leaf) => BigInt(leaf) === commitment_3
    );
    expect(commitmentIndex).to.be.gte(0);

    merkleProof = tree.getProof(commitmentIndex);
    const { nullifier: nullifier_3, nullifierHex: nullifierHex_3 } = 
      calculateNullifier(addr20_3, ALICE_SECRET_3);

    circuitInput = {
      root: tree.root,
      nullifier: nullifier_3,
      to: BigInt(alice.address), // Redeem to Alice's real address
      remintAmount: 1n,
      id: nftTokenId,
      redeem: 1n,
      relayerFee: 0n,
      secret: ALICE_SECRET_3,
      addr20: addr20_3,
      commitAmount: 1n,
      q: q_3,
      pathElements: merkleProof.pathElements.map((e) => BigInt(e)),
      pathIndices: merkleProof.pathIndices,
    };

    console.log("   ⏳ Generating ZK proof...");
    ({ proofBytes } = await generateZKProof(circuitInput));
    console.log("   ✅ ZK proof generated!");

    await expect(
      zwerc721.remint(alice.address, nftTokenId, 1, {
        commitment: localRoot,
        nullifiers: [nullifierHex_3],
        proverData: "0x",
        relayerData: "0x",
        redeem: true,
        proof: proofBytes,
      })
    ).to.emit(zwerc721, "Reminted");

    // Verify Alice received the underlying NFT
    expect(await underlying721.ownerOf(nftTokenId)).to.equal(alice.address);
    console.log(`   ✅ Alice redeemed underlying NFT #${nftTokenId} to her real address`);

    // Summary
    console.log("\n" + "=".repeat(70));
    console.log("📊 Same Person Consecutive Remint Summary:");
    console.log("   All operations by Alice using different secrets:");
    console.log("   1. Alice.address → privacyAddress_1 (transfer)");
    console.log("   2. privacyAddress_1 → privacyAddress_2 (remint with SECRET_1)");
    console.log("   3. privacyAddress_2 → privacyAddress_3 (remint with SECRET_2)");
    console.log("   4. privacyAddress_3 → Alice.address (remint+redeem with SECRET_3)");
    console.log("=".repeat(70));

    console.log("\n🎉 Same Person Consecutive Remint Test PASSED!");
  });
});
