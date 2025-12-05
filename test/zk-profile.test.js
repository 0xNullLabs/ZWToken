const { expect } = require("chai");
const { ethers } = require("hardhat");
const { poseidon } = require("circomlibjs");
const snarkjs = require("snarkjs");
const path = require("path");
const fs = require("fs");
const { IncrementalMerkleTree } = require("../utils/merkle-tree-utils");

/**
 * ZK Profile Test
 *
 * Measures:
 * - Circuit file sizes
 * - Proof generation time
 * - Memory usage
 * - Mobile browser compatibility assessment
 */
describe("ZK Profile - Circuit Performance Metrics", function () {
  this.timeout(120000); // 2 minutes for proof generation

  const projectRoot = path.join(__dirname, "..");
  const wasmPath = path.join(projectRoot, "circuits/out/remint_js/remint.wasm");
  const zkeyPath = path.join(projectRoot, "circuits/out/remint_0000.zkey");
  const vkeyPath = path.join(projectRoot, "circuits/out/verification_key.json");
  const r1csPath = path.join(projectRoot, "circuits/out/remint.r1cs");

  let zkProfile = {
    circuit: {
      name: "remint.circom",
      description:
        "Privacy-preserving remint circuit with Poseidon Merkle proof",
    },
    files: {},
    proofGeneration: {},
    memory: {},
    mobileAssessment: {},
  };

  before(async function () {
    console.log("\n" + "=".repeat(70));
    console.log("🔐 ZK PROFILE - Circuit Performance Metrics");
    console.log("=".repeat(70));
  });

  it("Should measure circuit file sizes", function () {
    console.log("\n📦 Circuit File Sizes:");

    // Check WASM file
    if (fs.existsSync(wasmPath)) {
      const wasmStats = fs.statSync(wasmPath);
      const wasmSizeMB = (wasmStats.size / (1024 * 1024)).toFixed(2);
      zkProfile.files.wasm = {
        path: "circuits/out/remint_js/remint.wasm",
        sizeBytes: wasmStats.size,
        sizeMB: parseFloat(wasmSizeMB),
      };
      console.log(`  ✓ remint.wasm: ${wasmSizeMB} MB`);
    } else {
      console.log(`  ✗ remint.wasm: NOT FOUND`);
    }

    // Check zKey file
    if (fs.existsSync(zkeyPath)) {
      const zkeyStats = fs.statSync(zkeyPath);
      const zkeySizeMB = (zkeyStats.size / (1024 * 1024)).toFixed(2);
      zkProfile.files.zkey = {
        path: "circuits/out/remint_0000.zkey",
        sizeBytes: zkeyStats.size,
        sizeMB: parseFloat(zkeySizeMB),
      };
      console.log(`  ✓ remint_0000.zkey: ${zkeySizeMB} MB`);
    } else {
      console.log(`  ✗ remint_0000.zkey: NOT FOUND`);
    }

    // Check verification key
    if (fs.existsSync(vkeyPath)) {
      const vkeyStats = fs.statSync(vkeyPath);
      const vkeySizeKB = (vkeyStats.size / 1024).toFixed(2);
      zkProfile.files.vkey = {
        path: "circuits/out/verification_key.json",
        sizeBytes: vkeyStats.size,
        sizeKB: parseFloat(vkeySizeKB),
      };
      console.log(`  ✓ verification_key.json: ${vkeySizeKB} KB`);
    }

    // Total download size (for browser)
    const totalMB =
      (zkProfile.files.wasm?.sizeMB || 0) + (zkProfile.files.zkey?.sizeMB || 0);
    zkProfile.files.totalDownloadMB = parseFloat(totalMB.toFixed(2));
    console.log(`  ➤ Total Download: ${totalMB.toFixed(2)} MB`);

    expect(zkProfile.files.wasm).to.exist;
    expect(zkProfile.files.zkey).to.exist;
  });

  it("Should benchmark proof generation performance", async function () {
    console.log("\n⏱️  Proof Generation Benchmark:");

    // Prepare circuit input
    const secret = 123456789n;
    const tokenId = 0n; // ERC-20 fixed to 0
    const addrScalar = poseidon([8065n, tokenId, secret]);
    const addr20 = addrScalar & ((1n << 160n) - 1n);
    const q = (addrScalar - addr20) / (1n << 160n);
    const commitAmount = 500n;
    const remintAmount = 300n;

    const commitment = poseidon([addr20, commitAmount]);
    const nullifier = poseidon([addr20, secret]);

    // Build Merkle tree
    const tree = new IncrementalMerkleTree(20);
    tree.insert(commitment);
    const merkleProof = tree.getProof(0);

    const circuitInput = {
      // Public inputs
      root: tree.root,
      nullifier: nullifier,
      to: addr20,
      remintAmount: remintAmount,
      id: tokenId,
      withdrawUnderlying: 0n,
      relayerFee: 0n,
      // Private inputs
      secret: secret,
      addr20: addr20,
      commitAmount: commitAmount,
      q: q,
      pathElements: merkleProof.pathElements.map((x) => BigInt(x)),
      pathIndices: merkleProof.pathIndices,
    };

    // Warm-up run (not counted)
    console.log("  🔥 Warming up...");
    await snarkjs.groth16.fullProve(circuitInput, wasmPath, zkeyPath);

    // Benchmark runs
    const numRuns = 5;
    const times = [];
    const memoryUsages = [];

    console.log(`  📊 Running ${numRuns} proof generations...`);

    for (let i = 0; i < numRuns; i++) {
      const memBefore = process.memoryUsage();
      const startTime = Date.now();

      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        circuitInput,
        wasmPath,
        zkeyPath
      );

      const endTime = Date.now();
      const memAfter = process.memoryUsage();

      const duration = endTime - startTime;
      times.push(duration);

      const memIncrease = {
        heapUsed: (memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024),
        external: (memAfter.external - memBefore.external) / (1024 * 1024),
      };
      memoryUsages.push(memIncrease);

      console.log(`    Run ${i + 1}: ${duration}ms`);

      // Store proof size info (only once)
      if (i === 0) {
        const proofJson = JSON.stringify(proof);
        zkProfile.proofGeneration.output = {
          proofJsonSize: proofJson.length,
          publicSignalsCount: publicSignals.length,
          estimatedTxBytes: proofJson.length + publicSignals.length * 32,
        };
      }
    }

    // Calculate statistics
    const average = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    const min = Math.min(...times);
    const max = Math.max(...times);
    const median = times.sort((a, b) => a - b)[Math.floor(times.length / 2)];

    zkProfile.proofGeneration = {
      ...zkProfile.proofGeneration,
      runs: numRuns,
      times: times,
      average: average,
      min: min,
      max: max,
      median: median,
      unit: "ms",
    };

    // Memory statistics
    const avgHeapUsed =
      memoryUsages.reduce((a, b) => a + b.heapUsed, 0) / numRuns;
    const avgExternal =
      memoryUsages.reduce((a, b) => a + b.external, 0) / numRuns;

    zkProfile.memory = {
      averageHeapIncreaseMB: parseFloat(avgHeapUsed.toFixed(2)),
      averageExternalIncreaseMB: parseFloat(avgExternal.toFixed(2)),
      totalIncreaseMB: parseFloat((avgHeapUsed + avgExternal).toFixed(2)),
    };

    console.log(`\n  📈 Results:`);
    console.log(`    Average: ${average}ms`);
    console.log(`    Min: ${min}ms`);
    console.log(`    Max: ${max}ms`);
    console.log(`    Median: ${median}ms`);
    console.log(`\n  💾 Memory:`);
    console.log(`    Heap increase: ${avgHeapUsed.toFixed(2)} MB`);
    console.log(`    External increase: ${avgExternal.toFixed(2)} MB`);
    console.log(
      `    Total increase: ${(avgHeapUsed + avgExternal).toFixed(2)} MB`
    );

    expect(average).to.be.lessThan(5000); // Should be under 5 seconds
  });

  it("Should assess mobile browser compatibility", async function () {
    console.log("\n📱 Mobile Browser Compatibility Assessment:");

    // Desktop benchmark (from previous test)
    const desktopAvg = zkProfile.proofGeneration.average;

    // Mobile performance estimates (based on benchmarks)
    // Typical mobile is 3-4x slower than desktop for WASM operations
    const mobileMultipliers = {
      highEnd: 2.5, // iPhone 14 Pro, Samsung S23
      midRange: 3.5, // iPhone 12, Samsung A53
      lowEnd: 5.0, // Older devices
    };

    zkProfile.mobileAssessment = {
      desktopAvgMs: desktopAvg,
      estimates: {
        highEnd: {
          multiplier: mobileMultipliers.highEnd,
          estimatedMs: Math.round(desktopAvg * mobileMultipliers.highEnd),
          devices: ["iPhone 14 Pro", "Samsung S23", "Google Pixel 7"],
        },
        midRange: {
          multiplier: mobileMultipliers.midRange,
          estimatedMs: Math.round(desktopAvg * mobileMultipliers.midRange),
          devices: ["iPhone 12", "Samsung A53", "OnePlus 9"],
        },
        lowEnd: {
          multiplier: mobileMultipliers.lowEnd,
          estimatedMs: Math.round(desktopAvg * mobileMultipliers.lowEnd),
          devices: ["iPhone X", "Samsung A32", "Older devices"],
        },
      },
      memoryRequirement: {
        baselineMB: zkProfile.files.totalDownloadMB,
        runtimeMB: zkProfile.memory.totalIncreaseMB,
        totalMB: parseFloat(
          (
            zkProfile.files.totalDownloadMB + zkProfile.memory.totalIncreaseMB
          ).toFixed(2)
        ),
      },
      feasibility: {
        highEnd:
          desktopAvg * mobileMultipliers.highEnd < 5000
            ? "✅ Excellent"
            : "⚠️ Acceptable",
        midRange:
          desktopAvg * mobileMultipliers.midRange < 8000
            ? "✅ Good"
            : "⚠️ Acceptable",
        lowEnd:
          desktopAvg * mobileMultipliers.lowEnd < 15000
            ? "⚠️ Acceptable"
            : "❌ Poor",
      },
    };

    console.log(`  Desktop average: ${desktopAvg}ms`);
    console.log(`\n  Estimated mobile performance:`);
    console.log(
      `    High-end:  ~${zkProfile.mobileAssessment.estimates.highEnd.estimatedMs}ms ${zkProfile.mobileAssessment.feasibility.highEnd}`
    );
    console.log(
      `    Mid-range: ~${zkProfile.mobileAssessment.estimates.midRange.estimatedMs}ms ${zkProfile.mobileAssessment.feasibility.midRange}`
    );
    console.log(
      `    Low-end:   ~${zkProfile.mobileAssessment.estimates.lowEnd.estimatedMs}ms ${zkProfile.mobileAssessment.feasibility.lowEnd}`
    );

    console.log(`\n  Memory requirement:`);
    console.log(
      `    Circuit files: ${zkProfile.mobileAssessment.memoryRequirement.baselineMB} MB`
    );
    console.log(
      `    Runtime: ${zkProfile.mobileAssessment.memoryRequirement.runtimeMB} MB`
    );
    console.log(
      `    Total: ${zkProfile.mobileAssessment.memoryRequirement.totalMB} MB`
    );

    // Mobile browsers typically have 100-500MB available for WASM
    const isMemoryFeasible =
      zkProfile.mobileAssessment.memoryRequirement.totalMB < 100;
    console.log(
      `\n  ${isMemoryFeasible ? "✅" : "⚠️"} Memory feasibility: ${
        isMemoryFeasible ? "Good" : "May struggle on low-end devices"
      }`
    );

    expect(isMemoryFeasible).to.be.true;
  });

  it("Should get circuit constraints info", async function () {
    console.log("\n🔢 Circuit Constraints:");

    try {
      // Use snarkjs CLI to get circuit info
      const { execSync } = require("child_process");
      const output = execSync(`npx snarkjs r1cs info ${r1csPath}`, {
        encoding: "utf-8",
        cwd: projectRoot,
      });

      // Parse output
      const constraintsMatch = output.match(/# of Constraints: (\d+)/);
      const wiresMatch = output.match(/# of Wires: (\d+)/);
      const privateInputsMatch = output.match(/# of Private Inputs: (\d+)/);
      const publicInputsMatch = output.match(/# of Public Inputs: (\d+)/);

      zkProfile.circuit.constraints = constraintsMatch
        ? parseInt(constraintsMatch[1])
        : null;
      zkProfile.circuit.wires = wiresMatch ? parseInt(wiresMatch[1]) : null;
      zkProfile.circuit.privateInputs = privateInputsMatch
        ? parseInt(privateInputsMatch[1])
        : null;
      zkProfile.circuit.publicInputs = publicInputsMatch
        ? parseInt(publicInputsMatch[1])
        : null;

      console.log(`  Constraints: ${zkProfile.circuit.constraints}`);
      console.log(`  Wires: ${zkProfile.circuit.wires}`);
      console.log(`  Private Inputs: ${zkProfile.circuit.privateInputs}`);
      console.log(`  Public Inputs: ${zkProfile.circuit.publicInputs}`);
    } catch (error) {
      console.log(`  ⚠️ Could not get circuit info: ${error.message}`);
      zkProfile.circuit.constraints = "N/A (run snarkjs r1cs info manually)";
    }
  });

  after(function () {
    // Save ZK profile to file
    const outputPath = path.join(projectRoot, "zk-profile.json");
    fs.writeFileSync(outputPath, JSON.stringify(zkProfile, null, 2));

    console.log("\n" + "=".repeat(70));
    console.log("📄 ZK Profile saved to: zk-profile.json");
    console.log("=".repeat(70));

    // Print summary
    console.log("\n📊 Summary:");
    console.log(`  Circuit: ${zkProfile.circuit.name}`);
    console.log(`  Constraints: ${zkProfile.circuit.constraints || "N/A"}`);
    console.log(`  Total Download: ${zkProfile.files.totalDownloadMB} MB`);
    console.log(
      `  Proof Generation: ${zkProfile.proofGeneration.average}ms (desktop)`
    );
    console.log(
      `  Mobile (mid-range): ~${zkProfile.mobileAssessment?.estimates?.midRange?.estimatedMs}ms`
    );
    console.log(`  Memory: ${zkProfile.memory.totalIncreaseMB} MB`);
    console.log("");
  });
});
