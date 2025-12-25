const { expect } = require("chai");
const { ethers } = require("hardhat");
const { poseidon } = require("circomlibjs");
const snarkjs = require("snarkjs");
const path = require("path");
const fs = require("fs");
const { IncrementalMerkleTree } = require("../utils/merkle-tree-utils");

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
 * ZWERC20 E2E Test - Real ZK Proof
 *
 * New architecture key points:
 * 1. Based on Poseidon Merkle tree (no longer using state proof)
 * 2. Frontend rebuilds Merkle tree from on-chain data
 * 3. Generate Merkle proof + ZK proof
 * 4. Circuit: claim_first_receipt.circom (12K constraints)
 */
describe("ZWERC20 - E2E with Real ZK Proof", function () {
  let zwToken, underlying, verifier, poseidonT3;
  let deployer, alice, bob;

  const SECRET = 123456789n;

  // Path configuration
  const projectRoot = path.join(__dirname, "..");
  const wasmPath = path.join(projectRoot, "circuits/out/remint_js/remint.wasm");
  const zkeyPath = path.join(projectRoot, "circuits/out/remint_final.zkey");

  before(async function () {
    [deployer, alice, bob] = await ethers.getSigners();

    console.log("\n" + "=".repeat(70));
    console.log("🚀 Deploying contracts");
    console.log("=".repeat(70));

    // 1. Deploy PoseidonT3 library
    const PoseidonT3 = await ethers.getContractFactory(
      "poseidon-solidity/PoseidonT3.sol:PoseidonT3"
    );
    poseidonT3 = await PoseidonT3.deploy();
    await poseidonT3.waitForDeployment();
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

    // 3. Deploy Groth16Verifier (must compile circuit first)
    try {
      const Groth16Verifier = await ethers.getContractFactory(
        "Groth16Verifier"
      );
      verifier = await Groth16Verifier.deploy();
      await verifier.waitForDeployment();
      console.log("✅ Groth16Verifier:", await verifier.getAddress());
    } catch (error) {
      console.log("\n❌ Groth16Verifier not found!");
      console.log("📋 Please compile the circuit first:");
      console.log(
        "   1. Download PTAU: wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_22.ptau"
      );
      console.log("   2. Run: chmod +x scripts/build_circuit.sh");
      console.log("   3. Run: ./scripts/build_circuit.sh");
      console.log("   4. Run tests again\n");
      throw new Error(
        "Groth16Verifier contract not found. Please compile circuit first."
      );
    }

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
    console.log("✅ ZWERC20:", await zwToken.getAddress());

    // 5. Allocate underlying tokens
    await underlying.transfer(alice.address, ethers.parseEther("2000"));
    console.log("✅ Allocated 2000 tokens to Alice");
    console.log("\n📋 Verifier Type: Real Groth16 ✨");
  });

  it("Full workflow: deposit → transfer → generate real ZK proof → claim", async function () {
    this.timeout(180000); // 3 minute timeout (proof generation takes time)

    console.log("\n" + "=".repeat(70));
    console.log("📝 E2E Test: Real ZK Proof");
    console.log("=".repeat(70));

    // ========== Phase 1: Alice deposit ==========
    console.log("\n📌 Phase 1: Alice deposit underlying token");

    const depositAmount = ethers.parseEther("1000");
    await underlying
      .connect(alice)
      .approve(await zwToken.getAddress(), depositAmount);
    await zwToken.connect(alice).deposit(alice.address, 0, depositAmount);

    const aliceBalance = await zwToken.balanceOf(alice.address);
    console.log(`   Alice ZWT balance: ${ethers.formatEther(aliceBalance)}`);
    expect(aliceBalance).to.equal(depositAmount);

    // ========== Phase 2: Derive privacy address and transfer ==========
    console.log("\n📌 Phase 2: Derive privacy address and transfer");

    // Derive privacy address from secret: Poseidon(8065, tokenId, secret)
    const tokenId = 0n; // ERC-20 fixed to 0
    const addrScalar = poseidon([8065n, tokenId, SECRET]);
    const addr20 = addrScalar & ((1n << 160n) - 1n);
    const q = (addrScalar - addr20) / (1n << 160n);
    const privacyAddress = ethers.getAddress(
      "0x" + addr20.toString(16).padStart(40, "0")
    );

    console.log(`   Secret: ${SECRET}`);
    console.log(`   Privacy address: ${privacyAddress}`);
    console.log(`   q (quotient): ${q}`);

    // Alice transfers to privacy address
    const commitAmount = ethers.parseEther("500");
    const transferTx = await zwToken
      .connect(alice)
      .transfer(privacyAddress, commitAmount);
    await transferTx.wait();

    console.log(`   Transferred ${ethers.formatEther(commitAmount)} ZWT`);

    // Verify balance and commitment
    const privacyBalance = await zwToken.balanceOf(privacyAddress);
    expect(privacyBalance).to.equal(commitAmount);

    const commitmentCount = await zwToken.getCommitLeafCount(0);
    console.log(`   Commitment count: ${commitmentCount}`);
    expect(commitmentCount).to.equal(1);

    // ========== Phase 3: Rebuild Merkle tree ==========
    console.log(
      "\n📌 Phase 3: Rebuild Merkle tree from on-chain data (simulating frontend)"
    );

    // Get all commitments from storage
    const leafCount = await zwToken.getCommitLeafCount(0);
    console.log(`   Found ${leafCount} commitment(s)`);

    const [commitHashes, recipients, amounts] = await zwToken.getCommitLeaves(
      0,
      0,
      leafCount
    );
    console.log(`   Retrieved ${recipients.length} leaf(s) from storage`);

    // Rebuild Merkle tree (using shared utilities)
    const tree = new IncrementalMerkleTree(20);
    for (let i = 0; i < recipients.length; i++) {
      // Compute commitment = Poseidon(address, amount)
      // Note: address is derived from Poseidon(8065, id, secret), implicitly contains id
      const commitment = poseidon([BigInt(recipients[i]), BigInt(amounts[i])]);
      tree.insert(commitment);
    }

    const onchainRoot = await zwToken.root();
    const localRoot = "0x" + tree.root.toString(16).padStart(64, "0");
    console.log(`   On-chain root: ${onchainRoot}`);
    console.log(`   Local root:    ${localRoot}`);
    expect(localRoot).to.equal(onchainRoot);
    console.log("   ✅ Merkle tree rebuilt successfully");

    // ========== Phase 4: Generate Merkle proof ==========
    console.log("\n📌 Phase 4: Generate Merkle proof");

    const commitment = poseidon([addr20, BigInt(commitAmount)]);
    const commitmentHex = "0x" + commitment.toString(16).padStart(64, "0");
    console.log(`   Commitment: ${commitmentHex}`);

    const commitmentIndex = tree.leaves.findIndex(
      (leaf) => BigInt(leaf) === commitment
    );
    console.log(`   Commitment index: ${commitmentIndex}`);
    expect(commitmentIndex).to.equal(0);

    const merkleProof = tree.getProof(commitmentIndex);
    console.log(
      `   Merkle proof generated (${merkleProof.pathElements.length} elements)`
    );

    // ========== Phase 5: Prepare circuit input ==========
    console.log("\n📌 Phase 5: Prepare ZK circuit input");

    // nullifier = Poseidon(addr20, secret)
    const nullifier = poseidon([addr20, SECRET]);
    const nullifierHex = "0x" + nullifier.toString(16).padStart(64, "0");

    const remintAmountValue = ethers.parseEther("300");
    console.log(`   Remint amount: ${ethers.formatEther(remintAmountValue)}`);
    console.log(`   Commit amount: ${ethers.formatEther(commitAmount)}`);
    console.log(`   To (Bob): ${bob.address}`);
    console.log(`   Nullifier: ${nullifierHex}`);

    // Prepare relayer fee
    const relayerFee = 0n; // No relayer fee
    const relayerData = encodeRelayerData(relayerFee);
    console.log(`   RelayerFee: ${relayerFee}`);

    const circuitInput = {
      // Public inputs (7 for IERC8065)
      root: tree.root,
      nullifier: nullifier,
      to: BigInt(bob.address),
      remintAmount: BigInt(remintAmountValue),
      id: tokenId, // Token ID (0 for ERC-20)
      withdrawUnderlying: 0n, // 0 = mint ZWERC20, 1 = withdraw underlying
      relayerFee: relayerFee, // Relayer fee (basis points)

      // Private inputs
      secret: SECRET,
      addr20: addr20,
      commitAmount: BigInt(commitAmount),
      q: q,
      pathElements: merkleProof.pathElements.map((e) => BigInt(e)),
      pathIndices: merkleProof.pathIndices,
    };

    console.log("   ✅ Circuit input prepared");

    // ========== Phase 6: Generate real ZK proof ==========
    console.log("\n📌 Phase 6: Generate real ZK proof");

    // Check required files
    if (!fs.existsSync(wasmPath)) {
      throw new Error(
        `WASM file not found: ${wasmPath}\nRun: ./scripts/build_circuit.sh`
      );
    }
    if (!fs.existsSync(zkeyPath)) {
      throw new Error(
        `zKey file not found: ${zkeyPath}\nRun: ./scripts/build_circuit.sh`
      );
    }

    console.log(`   WASM file: ✅`);
    console.log(`   zKey file: ✅`);
    console.log("   ⏳ Generating ZK proof (10-30 seconds)...");

    // Generate real ZK proof
    const { proof: zkProof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInput,
      wasmPath,
      zkeyPath
    );

    console.log("   ✅ ZK proof generated!");
    console.log(`   📊 Public signals (${publicSignals.length} total):`);
    console.log(`      [0] root: ${publicSignals[0]}`);
    console.log(`      [1] nullifier: ${publicSignals[1]}`);
    console.log(`      [2] to: ${publicSignals[2]}`);
    console.log(`      [3] remintAmount: ${publicSignals[3]}`);
    console.log(`      [4] id: ${publicSignals[4]}`);
    console.log(`      [5] withdrawUnderlying: ${publicSignals[5]}`);
    console.log(`      [6] relayerFee: ${publicSignals[6]}`);

    // Format as Solidity calldata
    const calldata = await snarkjs.groth16.exportSolidityCallData(
      zkProof,
      publicSignals
    );
    const calldataJson = JSON.parse("[" + calldata + "]");
    const solidityProof = {
      a: calldataJson[0],
      b: calldataJson[1],
      c: calldataJson[2],
    };
    console.log("   ✅ Proof formatted for Solidity");

    // ========== Phase 7: Submit claim ==========
    console.log("\n📌 Phase 7: Submit claim transaction");

    console.log(
      `   Bob balance before: ${ethers.formatEther(
        await zwToken.balanceOf(bob.address)
      )}`
    );

    const proofBytes = encodeProof(
      solidityProof.a,
      solidityProof.b,
      solidityProof.c
    );
    const claimTx = await zwToken.remint(
      bob.address, // to
      0, // id
      remintAmountValue, // amount
      false, // withdrawUnderlying
      {
        // RemintData struct
        commitment: localRoot,
        nullifiers: [nullifierHex],
        proverData: "0x",
        relayerData: relayerData,
        proof: proofBytes,
      }
    );

    const receipt = await claimTx.wait();
    console.log(`   ✅ Claim succeeded! Gas used: ${receipt.gasUsed}`);

    // Verify event
    await expect(claimTx)
      .to.emit(zwToken, "Reminted")
      .withArgs(deployer.address, bob.address, 0, remintAmountValue, false);
    console.log("   ✅ Reminted event emitted");

    // Verify Bob received ZWERC20 (and triggered commitment since it's first receipt)
    const bobBalance = await zwToken.balanceOf(bob.address);
    console.log(`   Bob balance after: ${ethers.formatEther(bobBalance)}`);
    expect(bobBalance).to.equal(remintAmountValue);

    const commitmentCount2 = await zwToken.getCommitLeafCount(0);
    console.log(`   Commitment count: ${commitmentCount2}`);
    expect(commitmentCount2).to.equal(2); // privacy address + bob

    // ========== Phase 8: Test replay prevention ==========
    console.log("\n📌 Phase 8: Test replay prevention");

    await expect(
      zwToken.remint(
        bob.address, // to
        0, // id
        remintAmountValue, // amount
        false, // withdrawUnderlying
        {
          // RemintData struct
          commitment: localRoot,
          nullifiers: [nullifierHex],
          proverData: "0x",
          relayerData: relayerData,
          proof: proofBytes,
        }
      )
    ).to.be.revertedWithCustomError(zwToken, "NullifierUsed");

    console.log("   ✅ Replay protection verified");

    // ========== Phase 9: Bob withdraw ==========
    console.log("\n📌 Phase 9: Bob withdraw underlying token");

    await zwToken.connect(bob).withdraw(bob.address, 0, remintAmountValue); // (to, id, amount)

    const bobUnderlyingBalance = await underlying.balanceOf(bob.address);
    console.log(
      `   Bob underlying balance: ${ethers.formatEther(bobUnderlyingBalance)}`
    );
    expect(bobUnderlyingBalance).to.equal(remintAmountValue);

    const bobZWTBalance = await zwToken.balanceOf(bob.address);
    expect(bobZWTBalance).to.equal(0);
    console.log("   ✅ Withdraw succeeded");

    console.log("\n" + "=".repeat(70));
    console.log("🎉 E2E Test with REAL ZK Proof: PASSED!");
    console.log("=".repeat(70));

    console.log("\n📊 Summary:");
    console.log(`   Privacy address: ${privacyAddress}`);
    console.log(`   First amount: ${ethers.formatEther(commitAmount)}`);
    console.log(`   Claimed amount: ${ethers.formatEther(remintAmountValue)}`);
    console.log(
      `   Bob final balance: ${ethers.formatEther(
        bobUnderlyingBalance
      )} underlying`
    );
    console.log(`   Proof: Real Groth16 ✨`);
  });

  /**
   * Security test: Verify public inputs cannot be tampered
   *
   * This test group verifies security after circuit fixes:
   * - Tampering to address will cause proof verification to fail
   * - Tampering withdrawUnderlying will cause proof verification to fail
   * - Tampering relayerDataHash will cause proof verification to fail
   */
  describe("Public Inputs Tampering Attack Tests", function () {
    let validProof, validCircuitInput, tree;
    const SECRET = 999888777n;

    before(async function () {
      this.timeout(180000);

      console.log("\n" + "=".repeat(70));
      console.log("🔐 Preparing Public Inputs Tampering Tests");
      console.log("=".repeat(70));

      // Preparation: Give Alice more tokens
      await underlying.transfer(alice.address, ethers.parseEther("5000"));
      await underlying
        .connect(alice)
        .approve(await zwToken.getAddress(), ethers.parseEther("5000"));
      await zwToken
        .connect(alice)
        .deposit(alice.address, 0, ethers.parseEther("3000"));

      // Derive privacy address
      const tokenId = 0n;
      const addrScalar = poseidon([8065n, tokenId, SECRET]);
      const addr20 = addrScalar & ((1n << 160n) - 1n);
      const q = (addrScalar - addr20) / (1n << 160n);
      const privacyAddress = ethers.getAddress(
        "0x" + addr20.toString(16).padStart(40, "0")
      );

      // Transfer to privacy address
      const commitAmount = ethers.parseEther("1000");
      await zwToken.connect(alice).transfer(privacyAddress, commitAmount);

      // Rebuild Merkle tree
      const leafCount = await zwToken.getCommitLeafCount(0);
      const [, recipients, amounts] = await zwToken.getCommitLeaves(
        0,
        0,
        leafCount
      );

      tree = new IncrementalMerkleTree(20);
      for (let i = 0; i < recipients.length; i++) {
        const commitment = poseidon([
          BigInt(recipients[i]),
          BigInt(amounts[i]),
        ]);
        tree.insert(commitment);
      }

      // Find our commitment
      const commitment = poseidon([addr20, BigInt(commitAmount)]);
      const commitmentIndex = tree.leaves.findIndex(
        (leaf) => BigInt(leaf) === commitment
      );
      const merkleProof = tree.getProof(commitmentIndex);

      // Calculate nullifier
      const nullifier = poseidon([addr20, SECRET]);

      // Prepare relayer fee
      const relayerFee = 100n; // 1%
      const relayerData = encodeRelayerData(relayerFee);

      // Prepare circuit input
      validCircuitInput = {
        root: tree.root,
        nullifier: nullifier,
        to: BigInt(bob.address),
        remintAmount: ethers.parseEther("500"),
        id: tokenId,
        withdrawUnderlying: 0n,
        relayerFee: relayerFee,
        secret: SECRET,
        addr20: addr20,
        commitAmount: BigInt(commitAmount),
        q: q,
        pathElements: merkleProof.pathElements.map((e) => BigInt(e)),
        pathIndices: merkleProof.pathIndices,
      };

      console.log("   ⏳ Generating valid ZK proof...");

      // Generate valid proof
      const { proof: zkProof, publicSignals } = await snarkjs.groth16.fullProve(
        validCircuitInput,
        wasmPath,
        zkeyPath
      );

      const calldata = await snarkjs.groth16.exportSolidityCallData(
        zkProof,
        publicSignals
      );
      const calldataJson = JSON.parse("[" + calldata + "]");

      validProof = {
        a: calldataJson[0],
        b: calldataJson[1],
        c: calldataJson[2],
        nullifierHex: "0x" + nullifier.toString(16).padStart(64, "0"),
        relayerData: relayerData,
        localRoot: "0x" + tree.root.toString(16).padStart(64, "0"),
      };

      console.log("   ✅ Valid proof generation complete");
    });

    it("Tampering to address should cause proof verification to fail", async function () {
      console.log("\n" + "=".repeat(70));
      console.log("🔒 Test: Tampering to address");
      console.log("=".repeat(70));

      const proofBytes = encodeProof(validProof.a, validProof.b, validProof.c);

      // Tamper to address (proof has bob, but submit with deployer)
      console.log(`   Original to: ${bob.address}`);
      console.log(`   Tampered to: ${deployer.address}`);

      await expect(
        zwToken.remint(
          deployer.address, // Tampered! Was bob.address
          0,
          validCircuitInput.remintAmount,
          false,
          {
            commitment: validProof.localRoot,
            nullifiers: [validProof.nullifierHex],
            proverData: "0x",
            relayerData: validProof.relayerData,
            proof: proofBytes,
          }
        )
      ).to.be.revertedWithCustomError(zwToken, "InvalidProof");

      console.log(
        "   ✅ Verification failed (as expected): Tampering to address detected"
      );
    });

    it("Tampering withdrawUnderlying should cause proof verification to fail", async function () {
      console.log("\n" + "=".repeat(70));
      console.log("🔒 Test: Tampering withdrawUnderlying");
      console.log("=".repeat(70));

      const proofBytes = encodeProof(validProof.a, validProof.b, validProof.c);

      // Tamper withdrawUnderlying (proof has false, but submit with true)
      console.log(`   Original withdrawUnderlying: false`);
      console.log(`   Tampered withdrawUnderlying: true`);

      await expect(
        zwToken.remint(
          bob.address,
          0,
          validCircuitInput.remintAmount,
          true, // Tampered! Was false
          {
            commitment: validProof.localRoot,
            nullifiers: [validProof.nullifierHex],
            proverData: "0x",
            relayerData: validProof.relayerData,
            proof: proofBytes,
          }
        )
      ).to.be.revertedWithCustomError(zwToken, "InvalidProof");

      console.log(
        "   ✅ Verification failed (as expected): Tampering withdrawUnderlying detected"
      );
    });

    it("Tampering relayerFee should cause proof verification to fail", async function () {
      console.log("\n" + "=".repeat(70));
      console.log("🔒 Test: Tampering relayerFee");
      console.log("=".repeat(70));

      const proofBytes = encodeProof(validProof.a, validProof.b, validProof.c);

      // Tamper relayerData (modify relayer fee, causing different relayerFee to be parsed)
      const tamperedRelayerData = encodeRelayerData(500n); // 5% instead of 1%
      console.log(`   Original relayerFee: ${validCircuitInput.relayerFee}`);
      console.log(`   Tampered relayerFee: 500`);

      await expect(
        zwToken.remint(bob.address, 0, validCircuitInput.remintAmount, false, {
          commitment: validProof.localRoot,
          nullifiers: [validProof.nullifierHex],
          proverData: "0x",
          relayerData: tamperedRelayerData, // Tampered! Causes wrong relayerFee to be parsed
          proof: proofBytes,
        })
      ).to.be.revertedWithCustomError(zwToken, "InvalidProof");

      console.log(
        "   ✅ Verification failed (as expected): Tampering relayerFee detected"
      );
    });

    it("Tampering remintAmount should cause proof verification to fail", async function () {
      console.log("\n" + "=".repeat(70));
      console.log("🔒 Test: Tampering remintAmount");
      console.log("=".repeat(70));

      const proofBytes = encodeProof(validProof.a, validProof.b, validProof.c);

      // Tamper remintAmount
      const tamperedAmount = ethers.parseEther("999"); // Was 500
      console.log(
        `   Original amount: ${ethers.formatEther(
          validCircuitInput.remintAmount
        )}`
      );
      console.log(`   Tampered amount: ${ethers.formatEther(tamperedAmount)}`);

      await expect(
        zwToken.remint(
          bob.address,
          0,
          tamperedAmount, // Tampered!
          false,
          {
            commitment: validProof.localRoot,
            nullifiers: [validProof.nullifierHex],
            proverData: "0x",
            relayerData: validProof.relayerData,
            proof: proofBytes,
          }
        )
      ).to.be.revertedWithCustomError(zwToken, "InvalidProof");

      console.log(
        "   ✅ Verification failed (as expected): Tampering remintAmount detected"
      );
    });

    it("Using correct public inputs should verify successfully", async function () {
      console.log("\n" + "=".repeat(70));
      console.log("✅ Test: Correct public inputs");
      console.log("=".repeat(70));

      const proofBytes = encodeProof(validProof.a, validProof.b, validProof.c);

      // Use all correct parameters
      const bobBalanceBefore = await zwToken.balanceOf(bob.address);

      await expect(
        zwToken.remint(bob.address, 0, validCircuitInput.remintAmount, false, {
          commitment: validProof.localRoot,
          nullifiers: [validProof.nullifierHex],
          proverData: "0x",
          relayerData: validProof.relayerData,
          proof: proofBytes,
        })
      ).to.emit(zwToken, "Reminted");

      const bobBalanceAfter = await zwToken.balanceOf(bob.address);
      console.log(
        `   Bob balance before: ${ethers.formatEther(bobBalanceBefore)}`
      );
      console.log(
        `   Bob balance after: ${ethers.formatEther(bobBalanceAfter)}`
      );

      console.log("   ✅ Verification success: Correct public inputs passed");

      console.log("\n" + "=".repeat(70));
      console.log("🎉 Public Inputs Tampering Tests All Passed!");
      console.log("=".repeat(70));
    });
  });

  /**
   * Merkle Proof Correctness Test for Older Commitments
   *
   * This test verifies that getProof() works correctly for older commitments
   * after subsequent commitments have been inserted.
   *
   * Bug scenario (before fix):
   * - filledSubtrees[i] only stores the LAST left subtree at each level
   * - When proving an older leaf that is a right child, filledSubtrees[i]
   *   may have been overwritten by subsequent insertions
   * - This caused incorrect Merkle proofs and verification failures
   *
   * Fix: Always use _reconstructSubtree() to compute siblings, never rely
   * on filledSubtrees for proof generation.
   */
  describe("Merkle Proof for Older Commitments", function () {
    let zwToken2, underlying2, verifier2, poseidonT3_2;
    let user1, user2, user3, user4;

    // Different secrets for different users
    const SECRET_USER1 = 111111111n;
    const SECRET_USER2 = 222222222n;
    const SECRET_USER3 = 333333333n;

    before(async function () {
      this.timeout(60000);

      console.log("\n" + "=".repeat(70));
      console.log("🔧 Setting up Merkle Proof Correctness Test");
      console.log("=".repeat(70));

      [, , , user1, user2, user3, user4] = await ethers.getSigners();

      // Deploy fresh contracts for isolated testing
      const PoseidonT3 = await ethers.getContractFactory(
        "poseidon-solidity/PoseidonT3.sol:PoseidonT3"
      );
      poseidonT3_2 = await PoseidonT3.deploy();
      await poseidonT3_2.waitForDeployment();

      const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
      underlying2 = await ERC20Mock.deploy(
        "Test Token",
        "TEST",
        ethers.parseEther("1000000")
      );
      await underlying2.waitForDeployment();

      const Groth16Verifier = await ethers.getContractFactory(
        "Groth16Verifier"
      );
      verifier2 = await Groth16Verifier.deploy();
      await verifier2.waitForDeployment();

      const ZWERC20 = await ethers.getContractFactory(
        "contracts/ZWERC20.sol:ZWERC20",
        {
          libraries: {
            PoseidonT3: await poseidonT3_2.getAddress(),
          },
        }
      );
      zwToken2 = await ZWERC20.deploy(
        "Test ZWT",
        "TZWT",
        18,
        await underlying2.getAddress(),
        await verifier2.getAddress(),
        user1.address,
        10000,
        0,
        0,
        0
      );
      await zwToken2.waitForDeployment();

      // Allocate tokens to users
      await underlying2.transfer(user1.address, ethers.parseEther("10000"));
      await underlying2.transfer(user2.address, ethers.parseEther("10000"));
      await underlying2.transfer(user3.address, ethers.parseEther("10000"));

      console.log("   ✅ Fresh contracts deployed for isolated testing");
    });

    it("Should correctly prove the FIRST commitment after multiple insertions", async function () {
      this.timeout(180000);

      console.log("\n" + "=".repeat(70));
      console.log(
        "🧪 Test: Prove older commitment (index 0) after 3 insertions"
      );
      console.log("=".repeat(70));

      const tokenId = 0n;

      // ========== Step 1: Create 3 commitments ==========
      console.log("\n📌 Step 1: Create 3 commitments");

      // User1's privacy address and commitment (this will be at index 0)
      const addrScalar1 = poseidon([8065n, tokenId, SECRET_USER1]);
      const addr20_1 = addrScalar1 & ((1n << 160n) - 1n);
      const q1 = (addrScalar1 - addr20_1) / (1n << 160n);
      const privacyAddr1 = ethers.getAddress(
        "0x" + addr20_1.toString(16).padStart(40, "0")
      );

      // User2's privacy address (index 1)
      const addrScalar2 = poseidon([8065n, tokenId, SECRET_USER2]);
      const addr20_2 = addrScalar2 & ((1n << 160n) - 1n);
      const privacyAddr2 = ethers.getAddress(
        "0x" + addr20_2.toString(16).padStart(40, "0")
      );

      // User3's privacy address (index 2)
      const addrScalar3 = poseidon([8065n, tokenId, SECRET_USER3]);
      const addr20_3 = addrScalar3 & ((1n << 160n) - 1n);
      const privacyAddr3 = ethers.getAddress(
        "0x" + addr20_3.toString(16).padStart(40, "0")
      );

      // Deposit and transfer to create commitments
      const amount1 = ethers.parseEther("100");
      const amount2 = ethers.parseEther("200");
      const amount3 = ethers.parseEther("300");

      // User1 deposits and transfers to their privacy address (commitment 0)
      await underlying2
        .connect(user1)
        .approve(await zwToken2.getAddress(), amount1);
      await zwToken2.connect(user1).deposit(user1.address, 0, amount1);
      await zwToken2.connect(user1).transfer(privacyAddr1, amount1);
      console.log(
        `   ✅ Commitment 0: User1 -> ${privacyAddr1} (${ethers.formatEther(
          amount1
        )} tokens)`
      );

      // User2 deposits and transfers to their privacy address (commitment 1)
      await underlying2
        .connect(user2)
        .approve(await zwToken2.getAddress(), amount2);
      await zwToken2.connect(user2).deposit(user2.address, 0, amount2);
      await zwToken2.connect(user2).transfer(privacyAddr2, amount2);
      console.log(
        `   ✅ Commitment 1: User2 -> ${privacyAddr2} (${ethers.formatEther(
          amount2
        )} tokens)`
      );

      // User3 deposits and transfers to their privacy address (commitment 2)
      await underlying2
        .connect(user3)
        .approve(await zwToken2.getAddress(), amount3);
      await zwToken2.connect(user3).deposit(user3.address, 0, amount3);
      await zwToken2.connect(user3).transfer(privacyAddr3, amount3);
      console.log(
        `   ✅ Commitment 2: User3 -> ${privacyAddr3} (${ethers.formatEther(
          amount3
        )} tokens)`
      );

      const commitCount = await zwToken2.getCommitLeafCount(0);
      console.log(`   Total commitments: ${commitCount}`);
      expect(commitCount).to.equal(3);

      // ========== Step 2: Rebuild Merkle tree ==========
      console.log("\n📌 Step 2: Rebuild Merkle tree from chain");

      const leafCount = await zwToken2.getCommitLeafCount(0);
      const [, recipients, amounts] = await zwToken2.getCommitLeaves(
        0,
        0,
        leafCount
      );

      const tree = new IncrementalMerkleTree(20);
      for (let i = 0; i < recipients.length; i++) {
        const commitment = poseidon([
          BigInt(recipients[i]),
          BigInt(amounts[i]),
        ]);
        tree.insert(commitment);
        console.log(
          `   Leaf ${i}: addr=${recipients[i].slice(
            0,
            10
          )}..., amount=${ethers.formatEther(amounts[i])}`
        );
      }

      const onchainRoot = await zwToken2.root();
      const localRoot = "0x" + tree.root.toString(16).padStart(64, "0");
      console.log(`   On-chain root: ${onchainRoot}`);
      console.log(`   Local root:    ${localRoot}`);
      expect(localRoot).to.equal(onchainRoot);

      // ========== Step 3: Prove User1's commitment (index 0, the OLDEST one) ==========
      console.log(
        "\n📌 Step 3: Generate proof for commitment at index 0 (oldest)"
      );

      // This is the critical test case:
      // - Commitment 0 is at index 0 (left child at level 0)
      // - Its sibling at level 0 is commitment 1 (index 1)
      // - After inserting commitment 2, filledSubtrees[0] = commitment2's hash
      // - If we incorrectly used filledSubtrees[0], we'd get wrong sibling
      // - The fix ensures we reconstruct the correct sibling (commitment 1)

      const commitment1 = poseidon([addr20_1, BigInt(amount1)]);
      const commitmentIndex = tree.leaves.findIndex(
        (leaf) => BigInt(leaf) === commitment1
      );
      console.log(`   User1's commitment index: ${commitmentIndex}`);
      expect(commitmentIndex).to.equal(0);

      const merkleProof = tree.getProof(commitmentIndex);
      console.log(
        `   Merkle proof path elements: ${merkleProof.pathElements.length}`
      );
      console.log(
        `   Path indices (first 5): [${merkleProof.pathIndices
          .slice(0, 5)
          .join(", ")}]`
      );

      // ========== Step 4: Generate ZK proof ==========
      console.log("\n📌 Step 4: Generate ZK proof for User1");

      const nullifier1 = poseidon([addr20_1, SECRET_USER1]);
      const remintAmount = ethers.parseEther("50");

      const circuitInput = {
        root: tree.root,
        nullifier: nullifier1,
        to: BigInt(user4.address),
        remintAmount: BigInt(remintAmount),
        id: tokenId,
        withdrawUnderlying: 0n,
        relayerFee: 0n,
        secret: SECRET_USER1,
        addr20: addr20_1,
        commitAmount: BigInt(amount1),
        q: q1,
        pathElements: merkleProof.pathElements.map((e) => BigInt(e)),
        pathIndices: merkleProof.pathIndices,
      };

      console.log("   ⏳ Generating ZK proof...");
      const { proof: zkProof, publicSignals } = await snarkjs.groth16.fullProve(
        circuitInput,
        wasmPath,
        zkeyPath
      );
      console.log("   ✅ ZK proof generated");

      // ========== Step 5: Submit and verify ==========
      console.log("\n📌 Step 5: Submit remint transaction");

      const calldata = await snarkjs.groth16.exportSolidityCallData(
        zkProof,
        publicSignals
      );
      const calldataJson = JSON.parse("[" + calldata + "]");
      const proofBytes = encodeProof(
        calldataJson[0],
        calldataJson[1],
        calldataJson[2]
      );

      const user4BalanceBefore = await zwToken2.balanceOf(user4.address);
      console.log(
        `   User4 balance before: ${ethers.formatEther(user4BalanceBefore)}`
      );

      await expect(
        zwToken2.remint(user4.address, 0, remintAmount, false, {
          commitment: localRoot,
          nullifiers: ["0x" + nullifier1.toString(16).padStart(64, "0")],
          proverData: "0x",
          relayerData: "0x",
          proof: proofBytes,
        })
      ).to.emit(zwToken2, "Reminted");

      const user4BalanceAfter = await zwToken2.balanceOf(user4.address);
      console.log(
        `   User4 balance after: ${ethers.formatEther(user4BalanceAfter)}`
      );
      expect(user4BalanceAfter).to.equal(remintAmount);

      console.log("\n" + "=".repeat(70));
      console.log("🎉 Older Commitment Proof Test PASSED!");
      console.log("   - Successfully proved commitment at index 0");
      console.log("   - After 2 subsequent insertions (indices 1 and 2)");
      console.log("   - Merkle proof correctly reconstructed sibling subtrees");
      console.log("=".repeat(70));
    });

    it("Should correctly prove a RIGHT CHILD commitment after more insertions", async function () {
      this.timeout(180000);

      console.log("\n" + "=".repeat(70));
      console.log(
        "🧪 Test: Prove right-child commitment after subsequent insertions"
      );
      console.log("=".repeat(70));

      // Now we have 4 commitments (from previous test + user4 from remint)
      // Let's add one more and then prove commitment at index 1 (right child at level 0)

      const tokenId = 0n;

      // ========== Step 1: Check current state ==========
      console.log("\n📌 Step 1: Check current commitment count");
      const currentCount = await zwToken2.getCommitLeafCount(0);
      console.log(`   Current commitment count: ${currentCount}`);

      // Commitment at index 1 is User2's privacy address (right child at level 0)
      // Its left sibling is commitment 0 (User1's privacy address)
      // After the previous test, filledSubtrees[0] might have been overwritten

      // ========== Step 2: Rebuild tree and prove index 1 ==========
      console.log("\n📌 Step 2: Rebuild Merkle tree");

      const leafCount = await zwToken2.getCommitLeafCount(0);
      const [, recipients, amounts] = await zwToken2.getCommitLeaves(
        0,
        0,
        leafCount
      );

      const tree = new IncrementalMerkleTree(20);
      for (let i = 0; i < recipients.length; i++) {
        const commitment = poseidon([
          BigInt(recipients[i]),
          BigInt(amounts[i]),
        ]);
        tree.insert(commitment);
      }

      const onchainRoot = await zwToken2.root();
      const localRoot = "0x" + tree.root.toString(16).padStart(64, "0");
      expect(localRoot).to.equal(onchainRoot);
      console.log(`   Tree rebuilt with ${leafCount} leaves`);

      // ========== Step 3: Prove commitment at index 1 (RIGHT child) ==========
      console.log(
        "\n📌 Step 3: Generate proof for commitment at index 1 (right child)"
      );

      // User2's commitment is at index 1
      const addrScalar2 = poseidon([8065n, tokenId, SECRET_USER2]);
      const addr20_2 = addrScalar2 & ((1n << 160n) - 1n);
      const q2 = (addrScalar2 - addr20_2) / (1n << 160n);
      const amount2 = ethers.parseEther("200");

      const commitment2 = poseidon([addr20_2, BigInt(amount2)]);
      const commitmentIndex = tree.leaves.findIndex(
        (leaf) => BigInt(leaf) === commitment2
      );
      console.log(`   User2's commitment index: ${commitmentIndex}`);
      expect(commitmentIndex).to.equal(1); // Should be index 1 (right child at level 0)

      const merkleProof = tree.getProof(commitmentIndex);
      console.log(
        `   Path indices[0]: ${merkleProof.pathIndices[0]} (1 = right child)`
      );
      expect(merkleProof.pathIndices[0]).to.equal(1); // Confirm it's a right child

      // Verify the sibling is correct (should be commitment at index 0, NOT a later one)
      const expectedSibling = poseidon([
        BigInt(recipients[0]), // User1's privacy address
        BigInt(amounts[0]),
      ]);
      expect(merkleProof.pathElements[0]).to.equal(expectedSibling);
      console.log(
        `   ✅ Sibling at level 0 is correct (commitment 0, not a later one)`
      );

      // ========== Step 4: Generate and verify ZK proof ==========
      console.log("\n📌 Step 4: Generate and submit ZK proof");

      const nullifier2 = poseidon([addr20_2, SECRET_USER2]);
      const remintAmount = ethers.parseEther("100");

      const circuitInput = {
        root: tree.root,
        nullifier: nullifier2,
        to: BigInt(user4.address),
        remintAmount: BigInt(remintAmount),
        id: tokenId,
        withdrawUnderlying: 0n,
        relayerFee: 0n,
        secret: SECRET_USER2,
        addr20: addr20_2,
        commitAmount: BigInt(amount2),
        q: q2,
        pathElements: merkleProof.pathElements.map((e) => BigInt(e)),
        pathIndices: merkleProof.pathIndices,
      };

      console.log("   ⏳ Generating ZK proof...");
      const { proof: zkProof, publicSignals } = await snarkjs.groth16.fullProve(
        circuitInput,
        wasmPath,
        zkeyPath
      );
      console.log("   ✅ ZK proof generated");

      const calldata = await snarkjs.groth16.exportSolidityCallData(
        zkProof,
        publicSignals
      );
      const calldataJson = JSON.parse("[" + calldata + "]");
      const proofBytes = encodeProof(
        calldataJson[0],
        calldataJson[1],
        calldataJson[2]
      );

      const user4BalanceBefore = await zwToken2.balanceOf(user4.address);

      await expect(
        zwToken2.remint(user4.address, 0, remintAmount, false, {
          commitment: localRoot,
          nullifiers: ["0x" + nullifier2.toString(16).padStart(64, "0")],
          proverData: "0x",
          relayerData: "0x",
          proof: proofBytes,
        })
      ).to.emit(zwToken2, "Reminted");

      const user4BalanceAfter = await zwToken2.balanceOf(user4.address);
      console.log(
        `   User4 received: ${ethers.formatEther(
          user4BalanceAfter - user4BalanceBefore
        )}`
      );

      console.log("\n" + "=".repeat(70));
      console.log("🎉 Right Child Commitment Proof Test PASSED!");
      console.log(
        "   - Successfully proved commitment at index 1 (right child)"
      );
      console.log("   - Merkle proof correctly identified sibling at index 0");
      console.log("   - Did NOT use stale filledSubtrees value");
      console.log("=".repeat(70));
    });

    it("Should correctly remint with withdrawUnderlying=true", async function () {
      this.timeout(180000);

      console.log("\n" + "=".repeat(70));
      console.log("🧪 Test: Remint with withdrawUnderlying=true");
      console.log("=".repeat(70));

      const tokenId = 0n;
      const SECRET_NEW = 444444444n;

      // Create a fresh commitment for this test
      const addrScalarNew = poseidon([8065n, tokenId, SECRET_NEW]);
      const addr20New = addrScalarNew & ((1n << 160n) - 1n);
      const qNew = (addrScalarNew - addr20New) / (1n << 160n);
      const privacyAddrNew = ethers.getAddress(
        "0x" + addr20New.toString(16).padStart(40, "0")
      );

      // Fund and create commitment
      const commitAmount = ethers.parseEther("500");
      await underlying2
        .connect(user3)
        .approve(await zwToken2.getAddress(), commitAmount);
      await zwToken2.connect(user3).deposit(user3.address, 0, commitAmount);
      await zwToken2.connect(user3).transfer(privacyAddrNew, commitAmount);
      console.log(
        `   Created new commitment: ${privacyAddrNew} (${ethers.formatEther(
          commitAmount
        )} tokens)`
      );

      // Rebuild tree
      const leafCount = await zwToken2.getCommitLeafCount(0);
      const [, recipients, amounts] = await zwToken2.getCommitLeaves(
        0,
        0,
        leafCount
      );

      const tree = new IncrementalMerkleTree(20);
      for (let i = 0; i < recipients.length; i++) {
        const commitment = poseidon([
          BigInt(recipients[i]),
          BigInt(amounts[i]),
        ]);
        tree.insert(commitment);
      }

      const onchainRoot = await zwToken2.root();
      const localRoot = "0x" + tree.root.toString(16).padStart(64, "0");
      expect(localRoot).to.equal(onchainRoot);

      // Find the new commitment
      const commitmentNew = poseidon([addr20New, BigInt(commitAmount)]);
      const commitmentIndex = tree.leaves.findIndex(
        (leaf) => BigInt(leaf) === commitmentNew
      );
      console.log(`   Commitment index: ${commitmentIndex}`);
      expect(commitmentIndex).to.be.greaterThanOrEqual(0);

      const merkleProof = tree.getProof(commitmentIndex);
      const nullifierNew = poseidon([addr20New, SECRET_NEW]);
      const remintAmount = ethers.parseEther("200");

      // Generate proof with withdrawUnderlying=true (1n)
      const circuitInput = {
        root: tree.root,
        nullifier: nullifierNew,
        to: BigInt(user4.address),
        remintAmount: BigInt(remintAmount),
        id: tokenId,
        withdrawUnderlying: 1n, // TRUE - withdraw underlying instead of minting
        relayerFee: 0n,
        secret: SECRET_NEW,
        addr20: addr20New,
        commitAmount: BigInt(commitAmount),
        q: qNew,
        pathElements: merkleProof.pathElements.map((e) => BigInt(e)),
        pathIndices: merkleProof.pathIndices,
      };

      console.log("   ⏳ Generating ZK proof with withdrawUnderlying=1...");
      const { proof: zkProof, publicSignals } = await snarkjs.groth16.fullProve(
        circuitInput,
        wasmPath,
        zkeyPath
      );
      console.log("   ✅ ZK proof generated");
      console.log(
        `   Public signal [5] withdrawUnderlying: ${publicSignals[5]}`
      );

      const calldata = await snarkjs.groth16.exportSolidityCallData(
        zkProof,
        publicSignals
      );
      const calldataJson = JSON.parse("[" + calldata + "]");
      const proofBytes = encodeProof(
        calldataJson[0],
        calldataJson[1],
        calldataJson[2]
      );

      // Check user4's underlying balance before
      const user4UnderlyingBefore = await underlying2.balanceOf(user4.address);
      console.log(
        `   User4 underlying before: ${ethers.formatEther(
          user4UnderlyingBefore
        )}`
      );

      // Submit remint with withdrawUnderlying=true
      await expect(
        zwToken2.remint(user4.address, 0, remintAmount, true, {
          commitment: localRoot,
          nullifiers: ["0x" + nullifierNew.toString(16).padStart(64, "0")],
          proverData: "0x",
          relayerData: "0x",
          proof: proofBytes,
        })
      ).to.emit(zwToken2, "Reminted");

      const user4UnderlyingAfter = await underlying2.balanceOf(user4.address);
      console.log(
        `   User4 underlying after: ${ethers.formatEther(user4UnderlyingAfter)}`
      );
      expect(user4UnderlyingAfter - user4UnderlyingBefore).to.equal(
        remintAmount
      );

      console.log("\n" + "=".repeat(70));
      console.log("🎉 withdrawUnderlying=true Test PASSED!");
      console.log("=".repeat(70));
    });
  });
});
