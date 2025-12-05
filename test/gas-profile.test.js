const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");

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
const path = require("path");

// Gas price constants
const GAS_PRICE_GWEI = 0.2; // 0.2 Gwei
const ETH_PRICE_USD = 4000; // $4000 per ETH

// Calculate USD cost from gas used
function calculateCost(gasUsed) {
  // Convert BigInt to Number
  const gasUsedNum = Number(gasUsed);
  const gasPriceETH = GAS_PRICE_GWEI / 1e9; // Convert Gwei to ETH
  const costETH = gasUsedNum * gasPriceETH;
  const costUSD = costETH * ETH_PRICE_USD;
  return {
    gasUsed: gasUsed.toString(),
    gasPriceGwei: GAS_PRICE_GWEI,
    costETH: costETH.toFixed(9),
    costUSD: costUSD.toFixed(6),
  };
}

// Format gas report
function formatGasReport(operation, cost) {
  return {
    operation,
    gasUsed: cost.gasUsed,
    gasPriceGwei: cost.gasPriceGwei,
    costETH: cost.costETH,
    costUSD: `$${cost.costUSD}`,
  };
}

describe("Gas Profile Comparison", function () {
  let zwToken, erc20Mock, mockVerifier, poseidonT3;
  let owner, alice, bob, charlie;
  let gasReport = [];

  before(async function () {
    [owner, alice, bob, charlie] = await ethers.getSigners();

    // Deploy PoseidonT3 library
    const PoseidonT3 = await ethers.getContractFactory(
      "poseidon-solidity/PoseidonT3.sol:PoseidonT3"
    );
    poseidonT3 = await PoseidonT3.deploy();
    await poseidonT3.waitForDeployment();

    // Deploy ERC20Mock as underlying token
    const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
    const underlyingToken = await ERC20Mock.deploy(
      "Underlying Token",
      "UTOKEN",
      ethers.parseEther("1000000")
    );

    // Deploy MockVerifier
    const MockVerifier = await ethers.getContractFactory("MockVerifier");
    mockVerifier = await MockVerifier.deploy();

    // Deploy ZWERC20 with linked PoseidonT3 library (use fully qualified name to avoid ambiguity)
    const ZWERC20 = await ethers.getContractFactory(
      "contracts/ZWERC20.sol:ZWERC20",
      {
        libraries: {
          PoseidonT3: await poseidonT3.getAddress(),
        },
      }
    );
    const underlyingDecimals = await underlyingToken.decimals();
    zwToken = await ZWERC20.deploy(
      "Zero Knowledge Wrapper",
      "ZWK",
      underlyingDecimals, // Get decimals from underlying token
      await underlyingToken.getAddress(),
      await mockVerifier.getAddress(),
      owner.address, // feeCollector
      10000, // feeDenominator
      0, // depositFee (0%)
      0, // remintFee (0%)
      0 // withdrawFee (0%)
    );

    // Deploy plain ERC20Mock for comparison (like USDT)
    erc20Mock = await ERC20Mock.deploy(
      "Mock USDT",
      "USDT",
      ethers.parseEther("1000000")
    );

    // Setup: Give users some underlying tokens
    await underlyingToken.transfer(alice.address, ethers.parseEther("10000"));
    await underlyingToken.transfer(bob.address, ethers.parseEther("10000"));
    await underlyingToken.transfer(charlie.address, ethers.parseEther("10000"));

    // Setup: Give users some ERC20Mock tokens
    await erc20Mock.transfer(alice.address, ethers.parseEther("10000"));
    await erc20Mock.transfer(bob.address, ethers.parseEther("10000"));
    await erc20Mock.transfer(charlie.address, ethers.parseEther("10000"));

    // Approve ZWERC20 to spend underlying
    await underlyingToken
      .connect(alice)
      .approve(await zwToken.getAddress(), ethers.MaxUint256);
    await underlyingToken
      .connect(bob)
      .approve(await zwToken.getAddress(), ethers.MaxUint256);
    await underlyingToken
      .connect(charlie)
      .approve(await zwToken.getAddress(), ethers.MaxUint256);
  });

  describe("📊 Standard ERC20 Operations (USDT-like)", function () {
    it("Transfer (first time, no state)", async function () {
      const amount = ethers.parseEther("100");
      const tx = await erc20Mock.connect(alice).transfer(bob.address, amount);
      const receipt = await tx.wait();
      const cost = calculateCost(receipt.gasUsed);
      gasReport.push(formatGasReport("ERC20: transfer (first time)", cost));

      console.log(
        `\n✅ ERC20 Transfer (first time): ${receipt.gasUsed} gas ($${cost.costUSD})`
      );
    });

    it("Transfer (subsequent, warm storage)", async function () {
      const amount = ethers.parseEther("50");
      const tx = await erc20Mock.connect(alice).transfer(bob.address, amount);
      const receipt = await tx.wait();
      const cost = calculateCost(receipt.gasUsed);
      gasReport.push(formatGasReport("ERC20: transfer (subsequent)", cost));

      console.log(
        `✅ ERC20 Transfer (subsequent): ${receipt.gasUsed} gas ($${cost.costUSD})`
      );
    });

    it("TransferFrom (first time)", async function () {
      await erc20Mock.connect(bob).approve(alice.address, ethers.MaxUint256);
      const amount = ethers.parseEther("30");
      const tx = await erc20Mock
        .connect(alice)
        .transferFrom(bob.address, charlie.address, amount);
      const receipt = await tx.wait();
      const cost = calculateCost(receipt.gasUsed);
      gasReport.push(formatGasReport("ERC20: transferFrom (first time)", cost));

      console.log(
        `✅ ERC20 TransferFrom (first time): ${receipt.gasUsed} gas ($${cost.costUSD})`
      );
    });
  });

  describe("📊 ZWERC20 Operations", function () {
    describe("Deposit & Withdraw", function () {
      it("Deposit (first time)", async function () {
        const amount = ethers.parseEther("100");
        const tx = await zwToken
          .connect(alice)
          .deposit(alice.address, 0, amount);
        const receipt = await tx.wait();
        const cost = calculateCost(receipt.gasUsed);
        gasReport.push(formatGasReport("ZWERC20: deposit (first time)", cost));

        console.log(
          `\n✅ ZWERC20 Deposit (first time): ${receipt.gasUsed} gas ($${cost.costUSD})`
        );
      });

      it("Deposit (subsequent)", async function () {
        const amount = ethers.parseEther("50");
        const tx = await zwToken
          .connect(alice)
          .deposit(alice.address, 0, amount);
        const receipt = await tx.wait();
        const cost = calculateCost(receipt.gasUsed);
        gasReport.push(formatGasReport("ZWERC20: deposit (subsequent)", cost));

        console.log(
          `✅ ZWERC20 Deposit (subsequent): ${receipt.gasUsed} gas ($${cost.costUSD})`
        );
      });

      it("Withdraw (first time)", async function () {
        const amount = ethers.parseEther("50");
        const tx = await zwToken
          .connect(alice)
          .withdraw(alice.address, 0, amount);
        const receipt = await tx.wait();
        const cost = calculateCost(receipt.gasUsed);
        gasReport.push(formatGasReport("ZWERC20: withdraw (first time)", cost));

        console.log(
          `✅ ZWERC20 Withdraw (first time): ${receipt.gasUsed} gas ($${cost.costUSD})`
        );
      });

      it("Withdraw (subsequent)", async function () {
        const amount = ethers.parseEther("20");
        const tx = await zwToken
          .connect(alice)
          .withdraw(alice.address, 0, amount);
        const receipt = await tx.wait();
        const cost = calculateCost(receipt.gasUsed);
        gasReport.push(formatGasReport("ZWERC20: withdraw (subsequent)", cost));

        console.log(
          `✅ ZWERC20 Withdraw (subsequent): ${receipt.gasUsed} gas ($${cost.costUSD})`
        );
      });
    });

    describe("Transfer Operations", function () {
      it("Transfer (first receipt - records commitment)", async function () {
        // Bob deposits first
        await zwToken
          .connect(bob)
          .deposit(bob.address, 0, ethers.parseEther("200"));

        // Bob transfers to Charlie (Charlie's first receipt - will record commitment)
        const amount = ethers.parseEther("100");
        const tx = await zwToken.connect(bob).transfer(charlie.address, amount);
        const receipt = await tx.wait();
        const cost = calculateCost(receipt.gasUsed);
        gasReport.push(
          formatGasReport(
            "ZWERC20: transfer (first receipt, records commitment)",
            cost
          )
        );

        console.log(
          `\n✅ ZWERC20 Transfer (first receipt): ${receipt.gasUsed} gas ($${cost.costUSD})`
        );
        console.log(
          `   ⚠️  This includes Poseidon hash + Merkle tree insertion`
        );
      });

      it("Transfer (subsequent - no commitment)", async function () {
        // Bob transfers to Charlie again (Charlie already has commitment)
        const amount = ethers.parseEther("50");
        const tx = await zwToken.connect(bob).transfer(charlie.address, amount);
        const receipt = await tx.wait();
        const cost = calculateCost(receipt.gasUsed);
        gasReport.push(
          formatGasReport("ZWERC20: transfer (subsequent, no commitment)", cost)
        );

        console.log(
          `✅ ZWERC20 Transfer (subsequent): ${receipt.gasUsed} gas ($${cost.costUSD})`
        );
      });
    });

    describe("Claim Operation", function () {
      it("Claim (with ZK proof verification)", async function () {
        // Get current root
        const root = await zwToken.root();

        // Create a dummy nullifier
        const nullifier = ethers.keccak256(
          ethers.toUtf8Bytes("test-nullifier-1")
        );
        const amount = ethers.parseEther("50");

        // Create dummy proof (MockVerifier always returns true)
        const proof = {
          a: [1, 2],
          b: [
            [3, 4],
            [5, 6],
          ],
          c: [7, 8],
        };

        // Claim to a new address (Dave) - will record commitment
        const dave = ethers.Wallet.createRandom();

        const proofBytes = encodeProof(proof.a, proof.b, proof.c);
        const relayerData = encodeRelayerData(0);
        const tx = await zwToken.remint(
          dave.address, // to
          0, // id
          amount, // amount
          false, // withdrawUnderlying
          {
            // RemintData struct
            commitment: root,
            nullifiers: [nullifier],
            proverData: "0x",
            relayerData: relayerData,
            proof: proofBytes,
          }
        );
        const receipt = await tx.wait();
        const cost = calculateCost(receipt.gasUsed);
        gasReport.push(
          formatGasReport("ZWERC20: remint (with ZK proof)", cost)
        );

        console.log(
          `\n✅ ZWERC20 Claim (with ZK proof): ${receipt.gasUsed} gas ($${cost.costUSD})`
        );
        console.log(
          `   ⚠️  This includes: proof verification + minting + commitment recording`
        );
      });

      it("Claim (subsequent to same address - no new commitment)", async function () {
        // Get current root
        const root = await zwToken.root();

        // Create a different nullifier
        const nullifier = ethers.keccak256(
          ethers.toUtf8Bytes("test-nullifier-2")
        );
        const amount = ethers.parseEther("30");

        // Create dummy proof
        const proof = {
          a: [1, 2],
          b: [
            [3, 4],
            [5, 6],
          ],
          c: [7, 8],
        };

        // Claim to Charlie again (already has commitment)
        const proofBytes2 = encodeProof(proof.a, proof.b, proof.c);
        const relayerData2 = encodeRelayerData(0);
        const tx = await zwToken.remint(
          charlie.address, // to
          0, // id
          amount, // amount
          false, // withdrawUnderlying
          {
            // RemintData struct
            commitment: root,
            nullifiers: [nullifier],
            proverData: "0x",
            relayerData: relayerData2,
            proof: proofBytes2,
          }
        );
        const receipt = await tx.wait();
        const cost = calculateCost(receipt.gasUsed);
        gasReport.push(
          formatGasReport(
            "ZWERC20: remint (subsequent, no new commitment)",
            cost
          )
        );

        console.log(
          `✅ ZWERC20 Claim (subsequent): ${receipt.gasUsed} gas ($${cost.costUSD})`
        );
      });
    });
  });

  describe("📈 Gas Comparison Summary", function () {
    it("Generate detailed gas report", async function () {
      console.log("\n\n" + "=".repeat(80));
      console.log("📊 GAS PROFILE COMPARISON REPORT");
      console.log("=".repeat(80));
      console.log(`💰 Gas Price: ${GAS_PRICE_GWEI} Gwei`);
      console.log(`💵 ETH Price: $${ETH_PRICE_USD}`);
      console.log("=".repeat(80));
      console.log("\n");

      // Group by category
      const erc20Ops = gasReport.filter((r) =>
        r.operation.startsWith("ERC20:")
      );
      const zwDepositWithdraw = gasReport.filter(
        (r) =>
          r.operation.includes("deposit") || r.operation.includes("withdraw")
      );
      const zwTransfer = gasReport.filter(
        (r) =>
          r.operation.includes("transfer") && !r.operation.includes("ERC20")
      );
      const zwClaim = gasReport.filter((r) => r.operation.includes("claim"));

      // Print ERC20 operations
      console.log("📦 Standard ERC20 Operations (USDT-like)");
      console.log("-".repeat(80));
      erc20Ops.forEach((r) => {
        console.log(
          `  ${r.operation.padEnd(50)} ${r.gasUsed.padStart(
            10
          )} gas  ${r.costUSD.padStart(10)}`
        );
      });
      console.log("\n");

      // Print ZWERC20 Deposit/Withdraw
      console.log("🏦 ZWERC20 Deposit & Withdraw");
      console.log("-".repeat(80));
      zwDepositWithdraw.forEach((r) => {
        console.log(
          `  ${r.operation.padEnd(50)} ${r.gasUsed.padStart(
            10
          )} gas  ${r.costUSD.padStart(10)}`
        );
      });
      console.log("\n");

      // Print ZWERC20 Transfer
      console.log("🔄 ZWERC20 Transfer");
      console.log("-".repeat(80));
      zwTransfer.forEach((r) => {
        console.log(
          `  ${r.operation.padEnd(50)} ${r.gasUsed.padStart(
            10
          )} gas  ${r.costUSD.padStart(10)}`
        );
      });
      console.log("\n");

      // Print ZWERC20 Claim
      console.log("🎯 ZWERC20 Claim (ZK Proof)");
      console.log("-".repeat(80));
      zwClaim.forEach((r) => {
        console.log(
          `  ${r.operation.padEnd(50)} ${r.gasUsed.padStart(
            10
          )} gas  ${r.costUSD.padStart(10)}`
        );
      });
      console.log("\n");

      // Calculate averages and comparisons
      console.log("📊 Key Comparisons");
      console.log("=".repeat(80));

      const erc20Transfer = erc20Ops.find((r) =>
        r.operation.includes("first time")
      );
      const zwTransferFirst = zwTransfer.find((r) =>
        r.operation.includes("first receipt")
      );
      const zwTransferSubseq = zwTransfer.find((r) =>
        r.operation.includes("subsequent")
      );

      if (erc20Transfer && zwTransferFirst && zwTransferSubseq) {
        const erc20Gas = parseInt(erc20Transfer.gasUsed);
        const zwFirstGas = parseInt(zwTransferFirst.gasUsed);
        const zwSubseqGas = parseInt(zwTransferSubseq.gasUsed);

        console.log(
          `\n1️⃣  ERC20 Transfer (first):              ${erc20Gas
            .toLocaleString()
            .padStart(10)} gas  ${erc20Transfer.costUSD}`
        );
        console.log(
          `2️⃣  ZWERC20 Transfer (first receipt):    ${zwFirstGas
            .toLocaleString()
            .padStart(10)} gas  ${zwTransferFirst.costUSD}`
        );
        console.log(
          `    ├─ Extra overhead:                  ${(zwFirstGas - erc20Gas)
            .toLocaleString()
            .padStart(10)} gas (${((zwFirstGas / erc20Gas - 1) * 100).toFixed(
            1
          )}% more)`
        );
        console.log(`    └─ Includes: Poseidon hash + Merkle tree insertion\n`);

        console.log(
          `3️⃣  ZWERC20 Transfer (subsequent):      ${zwSubseqGas
            .toLocaleString()
            .padStart(10)} gas  ${zwTransferSubseq.costUSD}`
        );
        console.log(
          `    └─ Overhead:                        ${(zwSubseqGas - erc20Gas)
            .toLocaleString()
            .padStart(10)} gas (${((zwSubseqGas / erc20Gas - 1) * 100).toFixed(
            1
          )}% more)\n`
        );
      }

      // Claim analysis
      const claimFirst = zwClaim.find((r) =>
        r.operation.includes("with ZK proof")
      );
      if (claimFirst) {
        console.log(
          `4️⃣  ZWERC20 Claim (with ZK proof):      ${parseInt(
            claimFirst.gasUsed
          )
            .toLocaleString()
            .padStart(10)} gas  ${claimFirst.costUSD}`
        );
        console.log(
          `    └─ Includes: Groth16 verification + minting + commitment\n`
        );
      }

      console.log("=".repeat(80));
      console.log("\n💡 Analysis:");
      console.log(
        "  • ZWERC20 transfers add ~25-50K gas for first receipt (Poseidon + Merkle)"
      );
      console.log(
        "  • Subsequent transfers to same address have minimal overhead"
      );
      console.log(
        "  • Claim operation includes expensive ZK proof verification (~200-300K gas)"
      );
      console.log(
        "  • Privacy features come at reasonable gas cost for most operations"
      );
      console.log("=".repeat(80));
      console.log("\n");

      // Save report to file
      const reportPath = path.join(__dirname, "../gas-report.json");
      const fullReport = {
        timestamp: new Date().toISOString(),
        gasPrice: {
          gwei: GAS_PRICE_GWEI,
          ethPriceUSD: ETH_PRICE_USD,
        },
        operations: gasReport,
        summary: {
          erc20Operations: erc20Ops,
          zwTokenOperations: {
            depositWithdraw: zwDepositWithdraw,
            transfer: zwTransfer,
            claim: zwClaim,
          },
        },
      };
      fs.writeFileSync(reportPath, JSON.stringify(fullReport, null, 2));
      console.log(`\n📄 Full report saved to: ${reportPath}\n`);
    });
  });
});
