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
});
