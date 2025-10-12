const { expect } = require("chai");
const { ethers } = require("hardhat");
const { poseidon } = require("circomlibjs");
const snarkjs = require("snarkjs");
const path = require("path");
const fs = require("fs");

/**
 * ZWToken E2E 测试 - 真实 ZK Proof
 *
 * 新架构要点：
 * 1. 基于 Poseidon Merkle tree（不再使用 state proof）
 * 2. 前端从链上重建 Merkle tree
 * 3. 生成 Merkle proof + ZK proof
 * 4. 电路：claim_first_receipt.circom（12K 约束）
 */
describe("ZWToken - E2E with Real ZK Proof", function () {
  let zwToken, underlying, verifier, poseidonT3;
  let deployer, alice, bob;

  const SECRET = 123456789n;

  // 路径配置
  const projectRoot = path.join(__dirname, "..");
  const wasmPath = path.join(
    projectRoot,
    "circuits/out/claim_first_receipt_js/claim_first_receipt.wasm"
  );
  const zkeyPath = path.join(
    projectRoot,
    "circuits/out/claim_first_receipt_final.zkey"
  );

  before(async function () {
    [deployer, alice, bob] = await ethers.getSigners();

    console.log("\n" + "=".repeat(70));
    console.log("🚀 部署合约");
    console.log("=".repeat(70));

    // 1. 部署 PoseidonT3 库
    const PoseidonT3 = await ethers.getContractFactory(
      "poseidon-solidity/PoseidonT3.sol:PoseidonT3"
    );
    poseidonT3 = await PoseidonT3.deploy();
    await poseidonT3.waitForDeployment();
    console.log("✅ PoseidonT3:", await poseidonT3.getAddress());

    // 2. 部署底层 ERC20
    const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
    underlying = await ERC20Mock.deploy(
      "Underlying Token",
      "UDLT",
      ethers.parseEther("1000000")
    );
    await underlying.waitForDeployment();
    console.log("✅ Underlying:", await underlying.getAddress());

    // 3. 部署 Groth16Verifier（必须先编译电路）
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

    // 4. 部署 ZWToken
    const ZWToken = await ethers.getContractFactory("ZWToken", {
      libraries: {
        PoseidonT3: await poseidonT3.getAddress(),
      },
    });
    zwToken = await ZWToken.deploy(
      "ZK Wrapper Token",
      "ZWT",
      await underlying.getAddress(),
      await verifier.getAddress()
    );
    await zwToken.waitForDeployment();
    console.log("✅ ZWToken:", await zwToken.getAddress());

    // 5. 分配 underlying token
    await underlying.transfer(alice.address, ethers.parseEther("2000"));
    console.log("✅ Allocated 2000 tokens to Alice");
    console.log("\n📋 Verifier Type: Real Groth16 ✨");
  });

  it("完整流程：deposit → transfer → 生成真实 ZK proof → claim", async function () {
    this.timeout(180000); // 3分钟超时（生成 proof 需要时间）

    console.log("\n" + "=".repeat(70));
    console.log("📝 E2E Test: Real ZK Proof");
    console.log("=".repeat(70));

    // ========== 阶段 1: Alice deposit ==========
    console.log("\n📌 阶段 1: Alice deposit underlying token");

    const depositAmount = ethers.parseEther("1000");
    await underlying
      .connect(alice)
      .approve(await zwToken.getAddress(), depositAmount);
    await zwToken.connect(alice).deposit(depositAmount);

    const aliceBalance = await zwToken.balanceOf(alice.address);
    console.log(`   Alice ZWT balance: ${ethers.formatEther(aliceBalance)}`);
    expect(aliceBalance).to.equal(depositAmount);

    // ========== 阶段 2: 推导隐私地址并转账 ==========
    console.log("\n📌 阶段 2: 推导隐私地址并转账");

    // 从 secret 推导隐私地址
    const addrScalar = poseidon([SECRET]);
    const addr20 = addrScalar & ((1n << 160n) - 1n);
    const q = (addrScalar - addr20) / (1n << 160n);
    const privacyAddress = ethers.getAddress(
      "0x" + addr20.toString(16).padStart(40, "0")
    );

    console.log(`   Secret: ${SECRET}`);
    console.log(`   Privacy address: ${privacyAddress}`);
    console.log(`   q (quotient): ${q}`);

    // Alice 转账到隐私地址
    const firstAmount = ethers.parseEther("500");
    const transferTx = await zwToken
      .connect(alice)
      .transfer(privacyAddress, firstAmount);
    await transferTx.wait();

    console.log(`   Transferred ${ethers.formatEther(firstAmount)} ZWT`);

    // 验证余额和 commitment
    const privacyBalance = await zwToken.balanceOf(privacyAddress);
    expect(privacyBalance).to.equal(firstAmount);

    const commitmentCount = await zwToken.getCommitmentCount();
    console.log(`   Commitment count: ${commitmentCount}`);
    expect(commitmentCount).to.equal(1);

    // ========== 阶段 3: 重建 Merkle tree ==========
    console.log("\n📌 阶段 3: 从链上重建 Merkle tree（模拟前端）");

    // 获取所有 commitment events
    const filter = zwToken.filters.CommitmentAdded();
    const events = await zwToken.queryFilter(filter, 0, "latest");
    console.log(`   Found ${events.length} commitment(s)`);

    // 重建 Merkle tree
    class IncrementalMerkleTree {
      constructor(depth) {
        this.depth = depth;
        this.zeros = [];
        this.filledSubtrees = new Array(depth);
        this.leaves = [];
        this.nextIndex = 0;

        // 初始化 zero hashes
        let currentZero = 0n;
        this.zeros[0] = currentZero;
        for (let i = 1; i < depth; i++) {
          currentZero = poseidon([currentZero, currentZero]);
          this.zeros[i] = currentZero;
        }
        this.root = this.zeros[depth - 1];
      }

      insert(leaf) {
        this.leaves.push(leaf);
        const index = this.nextIndex;
        let currentHash = BigInt(leaf);
        let currentIndex = index;

        for (let i = 0; i < this.depth; i++) {
          if (currentIndex % 2 === 0) {
            this.filledSubtrees[i] = currentHash;
            currentHash = poseidon([currentHash, this.zeros[i]]);
          } else {
            currentHash = poseidon([this.filledSubtrees[i], currentHash]);
          }
          currentIndex = Math.floor(currentIndex / 2);
        }

        this.root = currentHash;
        this.nextIndex++;
      }

      getProof(index) {
        const pathElements = [];
        const pathIndices = [];
        let currentIndex = index;

        for (let i = 0; i < this.depth; i++) {
          const isRight = currentIndex % 2 === 1;
          pathIndices.push(isRight ? 1 : 0);

          if (isRight) {
            pathElements.push(this.filledSubtrees[i] || this.zeros[i]);
          } else {
            const siblingIndex = currentIndex + 1;
            if (siblingIndex < this.nextIndex) {
              // 简化：直接使用 zero（实际应重建）
              pathElements.push(this.zeros[i]);
            } else {
              pathElements.push(this.zeros[i]);
            }
          }
          currentIndex = Math.floor(currentIndex / 2);
        }

        return { root: this.root, pathElements, pathIndices };
      }
    }

    const tree = new IncrementalMerkleTree(20);
    for (const event of events) {
      tree.insert(event.args.commitment);
    }

    const onchainRoot = await zwToken.root();
    const localRoot = "0x" + tree.root.toString(16).padStart(64, "0");
    console.log(`   On-chain root: ${onchainRoot}`);
    console.log(`   Local root:    ${localRoot}`);
    expect(localRoot).to.equal(onchainRoot);
    console.log("   ✅ Merkle tree rebuilt successfully");

    // ========== 阶段 4: 生成 Merkle proof ==========
    console.log("\n📌 阶段 4: 生成 Merkle proof");

    const commitment = poseidon([addr20, BigInt(firstAmount)]);
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

    // ========== 阶段 5: 准备电路输入 ==========
    console.log("\n📌 阶段 5: 准备 ZK 电路输入");

    const nullifier = poseidon([addr20]);
    const nullifierHex = "0x" + nullifier.toString(16).padStart(64, "0");

    const claimAmount = ethers.parseEther("300");
    console.log(`   Claim amount: ${ethers.formatEther(claimAmount)}`);
    console.log(`   First amount: ${ethers.formatEther(firstAmount)}`);
    console.log(`   To (Bob): ${bob.address}`);
    console.log(`   Nullifier: ${nullifierHex}`);

    const circuitInput = {
      // Public inputs
      root: tree.root,
      nullifier: nullifier,
      to: BigInt(bob.address),
      claimAmount: BigInt(claimAmount),

      // Private inputs
      secret: SECRET,
      addr20: addr20,
      firstAmount: BigInt(firstAmount),
      q: q,
      pathElements: merkleProof.pathElements.map((e) => BigInt(e)),
      pathIndices: merkleProof.pathIndices,
    };

    console.log("   ✅ Circuit input prepared");

    // ========== 阶段 6: 生成真实 ZK proof ==========
    console.log("\n📌 阶段 6: 生成真实 ZK proof");

    // 检查必需文件
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

    // 生成真实 ZK proof
    const { proof: zkProof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInput,
      wasmPath,
      zkeyPath
    );

    console.log("   ✅ ZK proof generated!");
    console.log(`   📊 Public signals:`);
    console.log(`      [0] root: ${publicSignals[0]}`);
    console.log(`      [1] nullifier: ${publicSignals[1]}`);
    console.log(`      [2] to: ${publicSignals[2]}`);
    console.log(`      [3] claimAmount: ${publicSignals[3]}`);

    // 格式化为 Solidity calldata
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

    // ========== 阶段 7: 提交 claim ==========
    console.log("\n📌 阶段 7: 提交 claim 交易");

    console.log(
      `   Bob balance before: ${ethers.formatEther(
        await zwToken.balanceOf(bob.address)
      )}`
    );

    const claimTx = await zwToken.claim(
      solidityProof.a,
      solidityProof.b,
      solidityProof.c,
      localRoot,
      nullifierHex,
      bob.address,
      claimAmount
    );

    const receipt = await claimTx.wait();
    console.log(`   ✅ Claim succeeded! Gas used: ${receipt.gasUsed}`);

    // 验证事件
    await expect(claimTx)
      .to.emit(zwToken, "Claimed")
      .withArgs(nullifierHex, bob.address, claimAmount);
    console.log("   ✅ Claimed event emitted");

    // 验证 Bob 收到 ZWToken（且触发了 commitment，因为是首次接收）
    const bobBalance = await zwToken.balanceOf(bob.address);
    console.log(`   Bob balance after: ${ethers.formatEther(bobBalance)}`);
    expect(bobBalance).to.equal(claimAmount);

    const commitmentCount2 = await zwToken.getCommitmentCount();
    console.log(`   Commitment count: ${commitmentCount2}`);
    expect(commitmentCount2).to.equal(2); // privacy address + bob

    // ========== 阶段 8: 测试防重放 ==========
    console.log("\n📌 阶段 8: 测试防重放");

    await expect(
      zwToken.claim(
        solidityProof.a,
        solidityProof.b,
        solidityProof.c,
        localRoot,
        nullifierHex,
        bob.address,
        claimAmount
      )
    ).to.be.revertedWithCustomError(zwToken, "NullifierUsed");

    console.log("   ✅ Replay protection verified");

    // ========== 阶段 9: Bob withdraw ==========
    console.log("\n📌 阶段 9: Bob withdraw underlying token");

    await zwToken.connect(bob).withdraw(claimAmount);

    const bobUnderlyingBalance = await underlying.balanceOf(bob.address);
    console.log(
      `   Bob underlying balance: ${ethers.formatEther(bobUnderlyingBalance)}`
    );
    expect(bobUnderlyingBalance).to.equal(claimAmount);

    const bobZWTBalance = await zwToken.balanceOf(bob.address);
    expect(bobZWTBalance).to.equal(0);
    console.log("   ✅ Withdraw succeeded");

    console.log("\n" + "=".repeat(70));
    console.log("🎉 E2E Test with REAL ZK Proof: PASSED!");
    console.log("=".repeat(70));

    console.log("\n📊 Summary:");
    console.log(`   Privacy address: ${privacyAddress}`);
    console.log(`   First amount: ${ethers.formatEther(firstAmount)}`);
    console.log(`   Claimed amount: ${ethers.formatEther(claimAmount)}`);
    console.log(
      `   Bob final balance: ${ethers.formatEther(
        bobUnderlyingBalance
      )} underlying`
    );
    console.log(`   Proof: Real Groth16 ✨`);
  });
});
