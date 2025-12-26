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
    console.log("✅ Minted 4 NFTs to Alice (tokenIds 0, 1, 2, 3)");
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
});
