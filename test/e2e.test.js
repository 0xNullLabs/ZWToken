const { expect } = require("chai");
const { ethers } = require("hardhat");
const { poseidon } = require("circomlibjs");
const snarkjs = require("snarkjs");
const path = require("path");
const fs = require("fs");
const { IncrementalMerkleTree } = require("../utils/merkle-tree-utils");

/**
 * Helper: 将 Groth16 proof 编码为 bytes
 */
function encodeProof(a, b, c) {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  return abiCoder.encode(
    ["uint256[2]", "uint256[2][2]", "uint256[2]"],
    [a, b, c]
  );
}

/**
 * Helper: 将 relayerFee 编码为 relayerData bytes
 */
function encodeRelayerData(relayerFee) {
  if (relayerFee === 0 || relayerFee === 0n) {
    return "0x"; // Empty bytes
  }
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  return abiCoder.encode(["uint256"], [relayerFee]);
}

/**
 * ZWERC20 E2E 测试 - 真实 ZK Proof
 *
 * 新架构要点：
 * 1. 基于 Poseidon Merkle tree（不再使用 state proof）
 * 2. 前端从链上重建 Merkle tree
 * 3. 生成 Merkle proof + ZK proof
 * 4. 电路：claim_first_receipt.circom（12K 约束）
 */
describe("ZWERC20 - E2E with Real ZK Proof", function () {
  let zwToken, underlying, verifier, poseidonT3;
  let deployer, alice, bob;

  const SECRET = 123456789n;

  // 路径配置
  const projectRoot = path.join(__dirname, "..");
  const wasmPath = path.join(projectRoot, "circuits/out/remint_js/remint.wasm");
  const zkeyPath = path.join(projectRoot, "circuits/out/remint_final.zkey");

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

    // 3. 部署 ZWERC20 (使用完全限定名避免歧义)
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
      underlyingDecimals, // 从 underlying token 获取 decimals
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
    await zwToken.connect(alice).deposit(alice.address, 0, depositAmount);

    const aliceBalance = await zwToken.balanceOf(alice.address);
    console.log(`   Alice ZWT balance: ${ethers.formatEther(aliceBalance)}`);
    expect(aliceBalance).to.equal(depositAmount);

    // ========== 阶段 2: 推导隐私地址并转账 ==========
    console.log("\n📌 阶段 2: 推导隐私地址并转账");

    // 从 secret 推导隐私地址：Poseidon(8065, tokenId, secret)
    const tokenId = 0n; // ERC-20 固定为 0
    const addrScalar = poseidon([8065n, tokenId, SECRET]);
    const addr20 = addrScalar & ((1n << 160n) - 1n);
    const q = (addrScalar - addr20) / (1n << 160n);
    const privacyAddress = ethers.getAddress(
      "0x" + addr20.toString(16).padStart(40, "0")
    );

    console.log(`   Secret: ${SECRET}`);
    console.log(`   Privacy address: ${privacyAddress}`);
    console.log(`   q (quotient): ${q}`);

    // Alice 转账到隐私地址
    const commitAmount = ethers.parseEther("500");
    const transferTx = await zwToken
      .connect(alice)
      .transfer(privacyAddress, commitAmount);
    await transferTx.wait();

    console.log(`   Transferred ${ethers.formatEther(commitAmount)} ZWT`);

    // 验证余额和 commitment
    const privacyBalance = await zwToken.balanceOf(privacyAddress);
    expect(privacyBalance).to.equal(commitAmount);

    const commitmentCount = await zwToken.getCommitLeafCount(0);
    console.log(`   Commitment count: ${commitmentCount}`);
    expect(commitmentCount).to.equal(1);

    // ========== 阶段 3: 重建 Merkle tree ==========
    console.log("\n📌 阶段 3: 从链上重建 Merkle tree（模拟前端）");

    // 获取所有 commitments 从存储
    const leafCount = await zwToken.getCommitLeafCount(0);
    console.log(`   Found ${leafCount} commitment(s)`);

    const [commitHashes, recipients, amounts] = await zwToken.getCommitLeaves(
      0,
      0,
      leafCount
    );
    console.log(`   Retrieved ${recipients.length} leaf(s) from storage`);

    // 重建 Merkle tree（使用共享工具）
    const tree = new IncrementalMerkleTree(20);
    for (let i = 0; i < recipients.length; i++) {
      // 计算 commitment = Poseidon(address, amount)
      // Note: address 已从 Poseidon(8065, id, secret) 推导，隐式包含 id
      const commitment = poseidon([BigInt(recipients[i]), BigInt(amounts[i])]);
      tree.insert(commitment);
    }

    const onchainRoot = await zwToken.root();
    const localRoot = "0x" + tree.root.toString(16).padStart(64, "0");
    console.log(`   On-chain root: ${onchainRoot}`);
    console.log(`   Local root:    ${localRoot}`);
    expect(localRoot).to.equal(onchainRoot);
    console.log("   ✅ Merkle tree rebuilt successfully");

    // ========== 阶段 4: 生成 Merkle proof ==========
    console.log("\n📌 阶段 4: 生成 Merkle proof");

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

    // ========== 阶段 5: 准备电路输入 ==========
    console.log("\n📌 阶段 5: 准备 ZK 电路输入");

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
    console.log(`   📊 Public signals (${publicSignals.length} total):`);
    console.log(`      [0] root: ${publicSignals[0]}`);
    console.log(`      [1] nullifier: ${publicSignals[1]}`);
    console.log(`      [2] to: ${publicSignals[2]}`);
    console.log(`      [3] remintAmount: ${publicSignals[3]}`);
    console.log(`      [4] id: ${publicSignals[4]}`);
    console.log(`      [5] withdrawUnderlying: ${publicSignals[5]}`);
    console.log(`      [6] relayerFee: ${publicSignals[6]}`);

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

    // 验证事件
    await expect(claimTx)
      .to.emit(zwToken, "Reminted")
      .withArgs(deployer.address, bob.address, 0, remintAmountValue, false);
    console.log("   ✅ Reminted event emitted");

    // 验证 Bob 收到 ZWERC20（且触发了 commitment，因为是首次接收）
    const bobBalance = await zwToken.balanceOf(bob.address);
    console.log(`   Bob balance after: ${ethers.formatEther(bobBalance)}`);
    expect(bobBalance).to.equal(remintAmountValue);

    const commitmentCount2 = await zwToken.getCommitLeafCount(0);
    console.log(`   Commitment count: ${commitmentCount2}`);
    expect(commitmentCount2).to.equal(2); // privacy address + bob

    // ========== 阶段 8: 测试防重放 ==========
    console.log("\n📌 阶段 8: 测试防重放");

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

    // ========== 阶段 9: Bob withdraw ==========
    console.log("\n📌 阶段 9: Bob withdraw underlying token");

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
   * 安全测试：验证 public inputs 不可被篡改
   * 
   * 这组测试验证电路修复后的安全性：
   * - 篡改 to 地址会导致 proof 验证失败
   * - 篡改 withdrawUnderlying 会导致 proof 验证失败  
   * - 篡改 relayerDataHash 会导致 proof 验证失败
   */
  describe("Public Inputs 篡改攻击测试", function () {
    let validProof, validCircuitInput, tree;
    const SECRET = 999888777n;
    
    before(async function () {
      this.timeout(180000);
      
      console.log("\n" + "=".repeat(70));
      console.log("🔐 准备 Public Inputs 篡改测试");
      console.log("=".repeat(70));
      
      // 准备：给 Alice 更多 token
      await underlying.transfer(alice.address, ethers.parseEther("5000"));
      await underlying.connect(alice).approve(await zwToken.getAddress(), ethers.parseEther("5000"));
      await zwToken.connect(alice).deposit(alice.address, 0, ethers.parseEther("3000"));
      
      // 推导隐私地址
      const tokenId = 0n;
      const addrScalar = poseidon([8065n, tokenId, SECRET]);
      const addr20 = addrScalar & ((1n << 160n) - 1n);
      const q = (addrScalar - addr20) / (1n << 160n);
      const privacyAddress = ethers.getAddress("0x" + addr20.toString(16).padStart(40, "0"));
      
      // 转账到隐私地址
      const commitAmount = ethers.parseEther("1000");
      await zwToken.connect(alice).transfer(privacyAddress, commitAmount);
      
      // 重建 Merkle tree
      const leafCount = await zwToken.getCommitLeafCount(0);
      const [, recipients, amounts] = await zwToken.getCommitLeaves(0, 0, leafCount);
      
      tree = new IncrementalMerkleTree(20);
      for (let i = 0; i < recipients.length; i++) {
        const commitment = poseidon([BigInt(recipients[i]), BigInt(amounts[i])]);
        tree.insert(commitment);
      }
      
      // 找到我们的 commitment
      const commitment = poseidon([addr20, BigInt(commitAmount)]);
      const commitmentIndex = tree.leaves.findIndex(leaf => BigInt(leaf) === commitment);
      const merkleProof = tree.getProof(commitmentIndex);
      
      // 计算 nullifier
      const nullifier = poseidon([addr20, SECRET]);
      
      // 准备 relayer fee
      const relayerFee = 100n; // 1%
      const relayerData = encodeRelayerData(relayerFee);
      
      // 准备电路输入
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
        pathElements: merkleProof.pathElements.map(e => BigInt(e)),
        pathIndices: merkleProof.pathIndices,
      };
      
      console.log("   ⏳ 生成有效的 ZK proof...");
      
      // 生成有效的 proof
      const { proof: zkProof, publicSignals } = await snarkjs.groth16.fullProve(
        validCircuitInput,
        wasmPath,
        zkeyPath
      );
      
      const calldata = await snarkjs.groth16.exportSolidityCallData(zkProof, publicSignals);
      const calldataJson = JSON.parse("[" + calldata + "]");
      
      validProof = {
        a: calldataJson[0],
        b: calldataJson[1],
        c: calldataJson[2],
        nullifierHex: "0x" + nullifier.toString(16).padStart(64, "0"),
        relayerData: relayerData,
        localRoot: "0x" + tree.root.toString(16).padStart(64, "0"),
      };
      
      console.log("   ✅ 有效 proof 生成完成");
    });
    
    it("篡改 to 地址应导致 proof 验证失败", async function () {
      console.log("\n" + "=".repeat(70));
      console.log("🔒 测试：篡改 to 地址");
      console.log("=".repeat(70));
      
      const proofBytes = encodeProof(validProof.a, validProof.b, validProof.c);
      
      // 篡改 to 地址（proof 中是 bob，但提交时用 deployer）
      console.log(`   Original to: ${bob.address}`);
      console.log(`   Tampered to: ${deployer.address}`);
      
      await expect(
        zwToken.remint(
          deployer.address,  // 篡改！原本是 bob.address
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
      
      console.log("   ✅ 验证失败（符合预期）：篡改 to 地址被检测到");
    });
    
    it("篡改 withdrawUnderlying 应导致 proof 验证失败", async function () {
      console.log("\n" + "=".repeat(70));
      console.log("🔒 测试：篡改 withdrawUnderlying");
      console.log("=".repeat(70));
      
      const proofBytes = encodeProof(validProof.a, validProof.b, validProof.c);
      
      // 篡改 withdrawUnderlying（proof 中是 false，但提交时用 true）
      console.log(`   Original withdrawUnderlying: false`);
      console.log(`   Tampered withdrawUnderlying: true`);
      
      await expect(
        zwToken.remint(
          bob.address,
          0,
          validCircuitInput.remintAmount,
          true,  // 篡改！原本是 false
          {
            commitment: validProof.localRoot,
            nullifiers: [validProof.nullifierHex],
            proverData: "0x",
            relayerData: validProof.relayerData,
            proof: proofBytes,
          }
        )
      ).to.be.revertedWithCustomError(zwToken, "InvalidProof");
      
      console.log("   ✅ 验证失败（符合预期）：篡改 withdrawUnderlying 被检测到");
    });
    
    it("篡改 relayerFee 应导致 proof 验证失败", async function () {
      console.log("\n" + "=".repeat(70));
      console.log("🔒 测试：篡改 relayerFee");
      console.log("=".repeat(70));
      
      const proofBytes = encodeProof(validProof.a, validProof.b, validProof.c);
      
      // 篡改 relayerData（修改 relayer fee，导致解析出不同的 relayerFee）
      const tamperedRelayerData = encodeRelayerData(500n); // 5% instead of 1%
      console.log(`   Original relayerFee: ${validCircuitInput.relayerFee}`);
      console.log(`   Tampered relayerFee: 500`);
      
      await expect(
        zwToken.remint(
          bob.address,
          0,
          validCircuitInput.remintAmount,
          false,
          {
            commitment: validProof.localRoot,
            nullifiers: [validProof.nullifierHex],
            proverData: "0x",
            relayerData: tamperedRelayerData,  // 篡改！导致解析出错误的 relayerFee
            proof: proofBytes,
          }
        )
      ).to.be.revertedWithCustomError(zwToken, "InvalidProof");
      
      console.log("   ✅ 验证失败（符合预期）：篡改 relayerFee 被检测到");
    });
    
    it("篡改 remintAmount 应导致 proof 验证失败", async function () {
      console.log("\n" + "=".repeat(70));
      console.log("🔒 测试：篡改 remintAmount");
      console.log("=".repeat(70));
      
      const proofBytes = encodeProof(validProof.a, validProof.b, validProof.c);
      
      // 篡改 remintAmount
      const tamperedAmount = ethers.parseEther("999"); // 原本是 500
      console.log(`   Original amount: ${ethers.formatEther(validCircuitInput.remintAmount)}`);
      console.log(`   Tampered amount: ${ethers.formatEther(tamperedAmount)}`);
      
      await expect(
        zwToken.remint(
          bob.address,
          0,
          tamperedAmount,  // 篡改！
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
      
      console.log("   ✅ 验证失败（符合预期）：篡改 remintAmount 被检测到");
    });
    
    it("使用正确的 public inputs 应验证成功", async function () {
      console.log("\n" + "=".repeat(70));
      console.log("✅ 测试：正确的 public inputs");
      console.log("=".repeat(70));
      
      const proofBytes = encodeProof(validProof.a, validProof.b, validProof.c);
      
      // 使用正确的所有参数
      const bobBalanceBefore = await zwToken.balanceOf(bob.address);
      
      await expect(
        zwToken.remint(
          bob.address,
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
      ).to.emit(zwToken, "Reminted");
      
      const bobBalanceAfter = await zwToken.balanceOf(bob.address);
      console.log(`   Bob balance before: ${ethers.formatEther(bobBalanceBefore)}`);
      console.log(`   Bob balance after: ${ethers.formatEther(bobBalanceAfter)}`);
      
      console.log("   ✅ 验证成功：正确的 public inputs 通过验证");
      
      console.log("\n" + "=".repeat(70));
      console.log("🎉 Public Inputs 篡改测试全部通过！");
      console.log("=".repeat(70));
    });
  });
});
