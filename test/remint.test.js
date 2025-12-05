const { expect } = require("chai");
const { ethers } = require("hardhat");
const { poseidon } = require("circomlibjs");

/**
 * Helper: Encode Groth16 proof as bytes
 */
function encodeProof(a, b, c) {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  return abiCoder.encode(
    ["uint256[2]", "uint256[2][2]", "uint256[2]"],
    [a, b, c]
  );
}

/**
 * Helper: Encode relayerFee as relayerData bytes
 */
function encodeRelayerData(relayerFee) {
  if (relayerFee === 0 || relayerFee === 0n) {
    return "0x"; // Empty bytes
  }
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  return abiCoder.encode(["uint256"], [relayerFee]);
}

/**
 * ZWERC20 Remint Test
 * Based on IERC8065: Poseidon Merkle tree + first receipt recording
 */
describe("ZWERC20 - Remint Test", function () {
  let zwToken, underlying, verifier, poseidonT3;
  let deployer, alice, bob;

  const SECRET = 123456789n;

  before(async function () {
    [deployer, alice, bob] = await ethers.getSigners();

    console.log("\n🚀 Deploying contracts...");

    // 1. Deploy PoseidonT3 library
    const PoseidonT3 = await ethers.getContractFactory(
      "poseidon-solidity/PoseidonT3.sol:PoseidonT3"
    );
    poseidonT3 = await PoseidonT3.deploy();
    await poseidonT3.waitForDeployment();
    console.log("✅ PoseidonT3 deployed:", await poseidonT3.getAddress());

    // 2. Deploy underlying ERC20
    const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
    underlying = await ERC20Mock.deploy(
      "Underlying Token",
      "UDLT",
      ethers.parseEther("1000000")
    );
    await underlying.waitForDeployment();
    console.log("✅ Underlying deployed:", await underlying.getAddress());

    // 2. Deploy Mock Verifier (always returns true)
    const MockVerifier = await ethers.getContractFactory("MockVerifier");
    verifier = await MockVerifier.deploy();
    await verifier.waitForDeployment();
    await verifier.setResult(true); // Set to always return true
    console.log("✅ Verifier deployed:", await verifier.getAddress());

    // 3. Deploy ZWERC20 (use fully qualified name to avoid ambiguity)
    const ZWERC20 = await ethers.getContractFactory(
      "contracts/ZWERC20.sol:ZWERC20",
      {
        libraries: {
          PoseidonT3: await poseidonT3.getAddress(),
        },
      }
    );
    const underlyingDecimals = await underlying.decimals();
    zwToken = await ZWERC20.deploy(
      "ZK Wrapper Token",
      "ZWT",
      underlyingDecimals, // Get decimals from underlying token
      await underlying.getAddress(),
      await verifier.getAddress(),
      deployer.address, // feeCollector
      10000, // feeDenominator
      0, // depositFee (0%)
      0, // remintFee (0%)
      0 // withdrawFee (0%)
    );
    await zwToken.waitForDeployment();
    console.log("✅ ZWERC20 deployed:", await zwToken.getAddress());

    // 5. Allocate underlying tokens
    await underlying.transfer(alice.address, ethers.parseEther("1000"));
    console.log("✅ Allocated tokens to Alice");
  });

  it("Full workflow: deposit → transfer to privacy address → remint → withdraw", async function () {
    console.log("\n" + "=".repeat(60));
    console.log("📝 Testing full workflow");
    console.log("=".repeat(60));

    // ========== Phase 1: Alice deposit ==========
    console.log("\n📌 Phase 1: Alice deposit underlying token");

    const depositAmount = ethers.parseEther("500");
    await underlying
      .connect(alice)
      .approve(await zwToken.getAddress(), depositAmount);
    await zwToken.connect(alice).deposit(alice.address, 0, depositAmount);

    const aliceBalance = await zwToken.balanceOf(alice.address);
    console.log(`   Alice ZWT balance: ${ethers.formatEther(aliceBalance)}`);
    expect(aliceBalance).to.equal(depositAmount);

    // Verify deposit does not record commitment
    const commitmentCount1 = await zwToken.getCommitLeafCount(0);
    console.log(`   Commitment count: ${commitmentCount1}`);
    expect(commitmentCount1).to.equal(0); // deposit does not record

    // ========== Phase 2: Calculate privacy address and transfer ==========
    console.log("\n📌 Phase 2: Calculate privacy address and transfer");

    // Derive privacy address from secret
    const tokenId = 0n; // ERC-20 fixed to 0
    const addrScalar = poseidon([8065n, tokenId, SECRET]);
    const addr20 = addrScalar & ((1n << 160n) - 1n);
    const privacyAddress = ethers.getAddress(
      "0x" + addr20.toString(16).padStart(40, "0")
    );

    console.log(`   Secret: ${SECRET}`);
    console.log(`   Privacy address: ${privacyAddress}`);

    // Alice transfers to privacy address
    const transferAmount = ethers.parseEther("200");
    const tx = await zwToken
      .connect(alice)
      .transfer(privacyAddress, transferAmount);
    const receipt = await tx.wait();

    console.log(`   Transferred ${ethers.formatEther(transferAmount)} ZWT`);

    // Verify transfer triggered commitment recording
    const commitmentCount2 = await zwToken.getCommitLeafCount(0);
    console.log(`   Commitment count: ${commitmentCount2}`);
    expect(commitmentCount2).to.equal(1); // First receipt, should record

    // Verify commitment value (get from storage)
    const [commitHashes, recipients, amounts] = await zwToken.getCommitLeaves(
      0,
      0,
      1
    );
    const storedCommitment = { to: recipients[0], amount: amounts[0] };

    expect(storedCommitment.to).to.equal(privacyAddress);
    expect(storedCommitment.amount).to.equal(transferAmount);

    console.log(
      `   Stored commitment - to: ${
        storedCommitment.to
      }, amount: ${ethers.formatEther(storedCommitment.amount)}`
    );

    // Verify privacy address balance
    const privacyBalance = await zwToken.balanceOf(privacyAddress);
    console.log(
      `   Privacy address balance: ${ethers.formatEther(privacyBalance)}`
    );
    expect(privacyBalance).to.equal(transferAmount);

    // ========== Phase 3: Construct ZK proof data ==========
    console.log("\n📌 Phase 3: Construct ZK proof data (simulating frontend)");

    // Get current root
    const root = await zwToken.root();
    console.log(`   Current root: ${root}`);

    // Calculate nullifier = Poseidon(addr20, secret)
    const nullifier = poseidon([addr20, SECRET]);
    const nullifierHex = "0x" + nullifier.toString(16).padStart(64, "0");
    console.log(`   Nullifier: ${nullifierHex}`);

    // Mock proof (actual should be generated by snarkjs)
    const mockProof = {
      a: [1n, 2n],
      b: [
        [3n, 4n],
        [5n, 6n],
      ],
      c: [7n, 8n],
    };

    console.log(`   ✅ Proof data prepared (mocked)`);

    // ========== Phase 4: Bob uses ZK proof to claim ==========
    console.log("\n📌 Phase 4: Bob uses ZK proof to claim");

    const claimAmount = ethers.parseEther("150");
    console.log(`   Bob address: ${bob.address}`);
    console.log(`   Claim amount: ${ethers.formatEther(claimAmount)}`);

    // Verify Bob's initial state
    const bobBalanceBefore = await zwToken.balanceOf(bob.address);
    expect(bobBalanceBefore).to.equal(0);

    // Bob submits remint
    const proofBytes = encodeProof(mockProof.a, mockProof.b, mockProof.c);
    const relayerData = encodeRelayerData(0);
    const claimTx = await zwToken.remint(
      bob.address, // to
      0, // id
      claimAmount, // amount
      false, // withdrawUnderlying
      {
        // RemintData struct
        commitment: root,
        nullifiers: [nullifierHex],
        proverData: "0x",
        relayerData: relayerData,
        proof: proofBytes,
      }
    );

    // Verify Reminted event
    await expect(claimTx)
      .to.emit(zwToken, "Reminted")
      .withArgs(deployer.address, bob.address, 0, claimAmount, false);

    // Verify commitment was created (Bob's first receipt)
    const leafCountAfterClaim = await zwToken.getCommitLeafCount(0);
    expect(leafCountAfterClaim).to.equal(2); // 1 from privacy address + 1 from claim

    // Verify latest commitment data
    const [claimCommitHashes, claimRecipients, claimAmounts] =
      await zwToken.getCommitLeaves(0, 1, 1);
    expect(claimRecipients[0]).to.equal(bob.address);
    expect(claimAmounts[0]).to.equal(claimAmount);

    const bobBalanceAfter = await zwToken.balanceOf(bob.address);
    console.log(`   Bob ZWT balance: ${ethers.formatEther(bobBalanceAfter)}`);
    expect(bobBalanceAfter).to.equal(claimAmount);

    // Verify commitment count increased
    const commitmentCount3 = await zwToken.getCommitLeafCount(0);
    console.log(`   Commitment count: ${commitmentCount3}`);
    expect(commitmentCount3).to.equal(2); // privacy address + bob

    // ========== Phase 5: Bob withdraw underlying token ==========
    console.log("\n📌 Phase 5: Bob withdraw underlying token");

    const bobUnderlyingBefore = await underlying.balanceOf(bob.address);
    console.log(
      `   Bob underlying before: ${ethers.formatEther(bobUnderlyingBefore)}`
    );

    await zwToken.connect(bob).withdraw(bob.address, 0, claimAmount);

    const bobUnderlyingAfter = await underlying.balanceOf(bob.address);
    const bobZWTAfter = await zwToken.balanceOf(bob.address);

    console.log(
      `   Bob underlying after: ${ethers.formatEther(bobUnderlyingAfter)}`
    );
    console.log(`   Bob ZWT after: ${ethers.formatEther(bobZWTAfter)}`);

    expect(bobUnderlyingAfter).to.equal(bobUnderlyingBefore + claimAmount);
    expect(bobZWTAfter).to.equal(0);

    // ========== Phase 6: Test replay prevention ==========
    console.log("\n📌 Phase 6: Test replay prevention");

    await expect(
      zwToken.remint(
        bob.address, // to
        0, // id
        claimAmount, // amount
        false, // withdrawUnderlying
        {
          // RemintData struct
          commitment: root,
          nullifiers: [nullifierHex],
          proverData: "0x",
          relayerData: relayerData,
          proof: proofBytes,
        }
      )
    ).to.be.revertedWithCustomError(zwToken, "NullifierUsed");

    console.log("   ✅ Replay prevention verified");

    console.log("\n" + "=".repeat(60));
    console.log("✅ Full workflow test passed!");
    console.log("=".repeat(60));
  });

  it("Test remint to address with existing balance", async function () {
    console.log("\n" + "=".repeat(60));
    console.log("📝 Test claim to address with existing balance");
    console.log("=".repeat(60));

    // Use new secret
    const tokenId = 0n; // ERC-20 fixed to 0
    const SECRET2 = 987654321n;
    const addrScalar2 = poseidon([8065n, tokenId, SECRET2]);
    const addr20_2 = addrScalar2 & ((1n << 160n) - 1n);
    const privacyAddress2 = ethers.getAddress(
      "0x" + addr20_2.toString(16).padStart(40, "0")
    );

    console.log(`\n📌 Preparation: Alice transfers to new privacy address`);
    console.log(`   Privacy address 2: ${privacyAddress2}`);

    // Alice transfers to new privacy address
    const transferAmount2 = ethers.parseEther("100");
    await zwToken.connect(alice).transfer(privacyAddress2, transferAmount2);
    console.log(`   ✅ Transferred ${ethers.formatEther(transferAmount2)} ZWT`);

    // Get current state
    const commitmentCountBefore = await zwToken.getCommitLeafCount(0);
    const root2 = await zwToken.root();
    const nullifier2 = poseidon([addr20_2]);
    const nullifierHex2 = "0x" + nullifier2.toString(16).padStart(64, "0");

    console.log(`   Current commitment count: ${commitmentCountBefore}`);

    // Bob claims again (should not add new commitment since Bob already has record)
    console.log(`\n📌 Bob claims again (should not add commitment)`);

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

    // Bob remint (should not emit CommitmentAdded)
    const proofBytes2 = encodeProof(mockProof2.a, mockProof2.b, mockProof2.c);
    const relayerData2 = encodeRelayerData(0);
    const claimTx = await zwToken.remint(
      bob.address, // to
      0, // id
      claimAmount2, // amount
      false, // withdrawUnderlying
      {
        // RemintData struct
        commitment: root2,
        nullifiers: [nullifierHex2],
        proverData: "0x",
        relayerData: relayerData2,
        proof: proofBytes2,
      }
    );

    // Should emit Reminted
    await expect(claimTx)
      .to.emit(zwToken, "Reminted")
      .withArgs(deployer.address, bob.address, 0, claimAmount2, false);

    // Should not create new commitment (Bob already has record)
    const leafCountAfterSecondClaim = await zwToken.getCommitLeafCount(0);
    expect(leafCountAfterSecondClaim).to.equal(3); // Should still be 3 commitments (no new one for Bob)
    console.log("   ✅ No new commitment created (as expected)");

    // Verify balance increased
    const bobBalanceAfter = await zwToken.balanceOf(bob.address);
    console.log(`   Bob balance after: ${ethers.formatEther(bobBalanceAfter)}`);
    expect(bobBalanceAfter).to.equal(bobBalanceBefore + claimAmount2);

    // Verify commitment count unchanged
    const commitmentCountAfter = await zwToken.getCommitLeafCount(0);
    console.log(`   Commitment count after: ${commitmentCountAfter}`);
    expect(commitmentCountAfter).to.equal(commitmentCountBefore);

    console.log("\n" + "=".repeat(60));
    console.log(
      "✅ Test passed: claim to existing address does not add commitment"
    );
    console.log("=".repeat(60));
  });

  it("Test Merkle root history support", async function () {
    console.log("\n" + "=".repeat(60));
    console.log("📝 Test Merkle root history support");
    console.log("=".repeat(60));

    // Use new secret
    const tokenId = 0n; // ERC-20 fixed to 0
    const SECRET3 = 111111111n;
    const addrScalar3 = poseidon([8065n, tokenId, SECRET3]);
    const addr20_3 = addrScalar3 & ((1n << 160n) - 1n);
    const privacyAddress3 = ethers.getAddress(
      "0x" + addr20_3.toString(16).padStart(40, "0")
    );

    console.log(`\n📌 Step 1: Record old root`);

    // Alice transfers to privacy address 3
    const transferAmount3 = ethers.parseEther("80");
    await zwToken.connect(alice).transfer(privacyAddress3, transferAmount3);

    const oldRoot = await zwToken.root();
    console.log(`   Old root: ${oldRoot}`);

    // Transfer another amount to new address, update root
    console.log(`\n📌 Step 2: Update root (transfer to new address)`);

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

    // Use old root to claim
    console.log(`\n📌 Step 3: Claim using old root (should succeed)`);

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

    // Use deployer to remint (new address)
    const claimAmount3 = ethers.parseEther("60");

    // Should succeed (oldRoot is still valid)
    const proofBytes3 = encodeProof(mockProof3.a, mockProof3.b, mockProof3.c);
    const relayerData3 = encodeRelayerData(0);
    await expect(
      zwToken.remint(
        deployer.address, // to
        0, // id
        claimAmount3, // amount
        false, // withdrawUnderlying
        {
          // RemintData struct
          commitment: oldRoot, // Use old root
          nullifiers: [nullifierHex3],
          proverData: "0x",
          relayerData: relayerData3,
          proof: proofBytes3,
        }
      )
    ).to.emit(zwToken, "Reminted");

    console.log("   ✅ Claim with old root succeeded");

    const deployerBalance = await zwToken.balanceOf(deployer.address);
    console.log(`   Deployer balance: ${ethers.formatEther(deployerBalance)}`);
    expect(deployerBalance).to.equal(claimAmount3);

    console.log("\n" + "=".repeat(60));
    console.log("✅ Test passed: historical root supported");
    console.log("=".repeat(60));
  });
});
