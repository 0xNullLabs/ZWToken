const { expect } = require("chai");
const { ethers } = require("hardhat");
const { poseidon } = require("circomlibjs");
const snarkjs = require("snarkjs");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);
const {
  ApolloClient,
  InMemoryCache,
  gql,
  HttpLink,
} = require("@apollo/client/core");
const fetch = require("cross-fetch");
const { IncrementalMerkleTree } = require("../utils/merkle-tree-utils");

/**
 * 真正的 Subgraph 集成测试
 *
 * 完整流程：
 * 1. 启动本地 Hardhat 节点（背景）
 * 2. 部署合约
 * 3. 启动 Graph Node 栈（Docker）
 * 4. 部署 Subgraph
 * 5. 执行交易产生事件
 * 6. 等待 Subgraph 索引
 * 7. 通过 GraphQL 查询数据
 * 8. 使用查询结果生成 ZK Proof
 * 9. 执行 Claim
 *
 * 注意：这个测试需要 Docker 和较长时间（~2-3 分钟）
 */
describe("ZWToken E2E - Real Subgraph Integration", function () {
  // 增加超时时间，因为需要启动 Docker 和索引
  this.timeout(300000); // 5 分钟

  let zwToken, underlying, verifier, poseidonT3;
  let deployer, alice, bob, charlie;
  let hardhatNodeProcess;
  let graphNodeRunning = false;
  let subgraphDeployed = false;
  let standaloneHardhatNode;

  const GRAPHQL_ENDPOINT =
    "http://localhost:8000/subgraphs/name/zwtoken/zwtoken";
  const SUBGRAPH_DIR = path.join(__dirname, "../subgraph");

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

  // Apollo Client for GraphQL queries
  let apolloClient;

  /**
   * 检查 Docker 是否运行
   */
  async function checkDockerRunning() {
    try {
      await execPromise("docker info");
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 启动 Graph Node 栈
   */
  async function startGraphNode() {
    console.log("   🐳 启动 Graph Node 栈...");

    try {
      // 先停止可能存在的旧容器
      await execPromise("cd subgraph && docker-compose down", {
        cwd: projectRoot,
      }).catch(() => {});

      // 启动新容器
      await execPromise("cd subgraph && docker-compose up -d", {
        cwd: projectRoot,
      });

      console.log("   ⏳ 等待 Graph Node 就绪（~30 秒）...");
      await new Promise((resolve) => setTimeout(resolve, 30000));

      // 验证服务是否就绪
      const maxRetries = 10;
      for (let i = 0; i < maxRetries; i++) {
        try {
          const response = await fetch("http://localhost:8000");
          if (response.ok) {
            console.log("   ✅ Graph Node 已就绪");
            return true;
          }
        } catch (e) {
          console.log(`   ⏳ 重试 ${i + 1}/${maxRetries}...`);
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }

      throw new Error("Graph Node 启动超时");
    } catch (error) {
      console.error("   ❌ 启动 Graph Node 失败:", error.message);
      throw error;
    }
  }

  /**
   * 停止 Graph Node 栈
   */
  async function stopGraphNode() {
    try {
      console.log("   🛑 停止 Graph Node 栈...");
      await execPromise("cd subgraph && docker-compose down", {
        cwd: projectRoot,
      });
      console.log("   ✅ Graph Node 已停止");
    } catch (error) {
      console.error("   ⚠️  停止 Graph Node 失败:", error.message);
    }
  }

  /**
   * 更新 subgraph.yaml 中的合约地址
   */
  async function updateSubgraphConfig(contractAddress) {
    const configPath = path.join(SUBGRAPH_DIR, "subgraph.yaml");
    let config = fs.readFileSync(configPath, "utf8");

    // 替换合约地址
    config = config.replace(
      /address: "0x[a-fA-F0-9]{40}"/,
      `address: "${contractAddress}"`
    );

    fs.writeFileSync(configPath, config);
    console.log(`   ✅ 更新 subgraph.yaml: ${contractAddress}`);
  }

  /**
   * 部署 Subgraph
   */
  async function deploySubgraph() {
    console.log("   📦 部署 Subgraph...");

    try {
      // 1. 安装依赖（如果需要）
      if (!fs.existsSync(path.join(SUBGRAPH_DIR, "node_modules"))) {
        console.log("   📦 安装 Subgraph 依赖...");
        await execPromise("npm install", { cwd: SUBGRAPH_DIR });
      }

      // 2. Codegen
      console.log("   🔧 生成 Subgraph 代码...");
      await execPromise("npm run codegen", { cwd: SUBGRAPH_DIR });

      // 3. Build
      console.log("   🏗️  编译 Subgraph...");
      await execPromise("npm run build", { cwd: SUBGRAPH_DIR });

      // 4. Create (如果还没创建)
      console.log("   📝 创建 Subgraph...");
      await execPromise(
        "npx graph create --node http://localhost:8020/ zwtoken/zwtoken",
        { cwd: SUBGRAPH_DIR }
      ).catch(() => {
        console.log("   ℹ️  Subgraph 已存在，跳过创建");
      });

      // 5. Deploy
      console.log("   🚀 部署 Subgraph...");
      await execPromise(
        "npx graph deploy --node http://localhost:8020/ --ipfs http://localhost:5001 --version-label v1.0.0 zwtoken/zwtoken",
        { cwd: SUBGRAPH_DIR }
      );

      console.log("   ✅ Subgraph 部署成功");
      return true;
    } catch (error) {
      console.error("   ❌ 部署 Subgraph 失败:", error.message);
      throw error;
    }
  }

  /**
   * 等待 Subgraph 索引完成
   */
  async function waitForSubgraphSync(minBlockNumber) {
    console.log(`   ⏳ 等待 Subgraph 索引到区块 ${minBlockNumber}...`);

    const maxWaitTime = 60000; // 60 秒
    const checkInterval = 2000; // 2 秒
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const response = await fetch("http://localhost:8030/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `
              {
                indexingStatusForCurrentVersion(subgraphName: "zwtoken/zwtoken") {
                  synced
                  health
                  chains {
                    latestBlock {
                      number
                    }
                    chainHeadBlock {
                      number
                    }
                  }
                }
              }
            `,
          }),
        });

        const result = await response.json();
        const status = result.data?.indexingStatusForCurrentVersion;

        if (status) {
          const latestBlock = parseInt(
            status.chains[0]?.latestBlock?.number || 0
          );
          console.log(
            `   📊 Subgraph 当前区块: ${latestBlock}, 目标: ${minBlockNumber}`
          );

          if (latestBlock >= minBlockNumber && status.synced) {
            console.log("   ✅ Subgraph 索引完成");
            return true;
          }
        }
      } catch (error) {
        console.log(
          `   ⏳ 等待索引... (${Math.floor((Date.now() - startTime) / 1000)}s)`
        );
      }

      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    throw new Error("Subgraph 索引超时");
  }

  /**
   * 通过 GraphQL 查询所有 commitments
   */
  async function queryCommitments() {
    const query = gql`
      query {
        commitments(orderBy: index, orderDirection: asc) {
          id
          commitment
          index
          recipient
          amount
          blockNumber
          blockTimestamp
          transactionHash
        }
      }
    `;

    const result = await apolloClient.query({
      query,
      fetchPolicy: "network-only",
    });
    return result.data.commitments;
  }

  before(async function () {
    console.log("\n" + "=".repeat(70));
    console.log("🚀 阶段 0: 环境准备");
    console.log("=".repeat(70));

    // 检查 Docker
    const dockerRunning = await checkDockerRunning();
    if (!dockerRunning) {
      console.log("❌ Docker 未运行，跳过此测试");
      console.log("💡 请启动 Docker Desktop 后重试");
      this.skip();
      return;
    }
    console.log("✅ Docker 正在运行");

    // 检查电路文件
    if (!fs.existsSync(wasmPath) || !fs.existsSync(zkeyPath)) {
      console.log("⚠️  电路文件未找到，跳过此测试");
      console.log("💡 运行 ./scripts/build_circuit.sh 编译电路");
      this.skip();
      return;
    }
    console.log("✅ 电路文件已就绪");

    // 获取签名者
    [deployer, alice, bob, charlie] = await ethers.getSigners();

    console.log("\n" + "=".repeat(70));
    console.log("🚀 阶段 1: 部署合约");
    console.log("=".repeat(70));

    // 部署 PoseidonT3
    const PoseidonT3 = await ethers.getContractFactory(
      "poseidon-solidity/PoseidonT3.sol:PoseidonT3"
    );
    poseidonT3 = await PoseidonT3.deploy();
    await poseidonT3.waitForDeployment();
    console.log("✅ PoseidonT3:", await poseidonT3.getAddress());

    // 部署 ERC20
    const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
    underlying = await ERC20Mock.deploy(
      "Underlying Token",
      "UDLT",
      ethers.parseEther("1000000")
    );
    await underlying.waitForDeployment();
    console.log("✅ Underlying:", await underlying.getAddress());

    // 部署 Groth16Verifier
    const Groth16Verifier = await ethers.getContractFactory("Groth16Verifier");
    verifier = await Groth16Verifier.deploy();
    await verifier.waitForDeployment();
    console.log("✅ Groth16Verifier:", await verifier.getAddress());

    // 部署 ZWToken
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
    const zwTokenAddress = await zwToken.getAddress();
    console.log("✅ ZWToken:", zwTokenAddress);

    // 分配 tokens
    await underlying.transfer(alice.address, ethers.parseEther("2000"));
    await underlying.transfer(bob.address, ethers.parseEther("1000"));
    console.log("✅ 分配 tokens 给 Alice 和 Bob");

    console.log("\n" + "=".repeat(70));
    console.log("🚀 阶段 2: 启动 Graph Node 并部署 Subgraph");
    console.log("=".repeat(70));

    // 更新 Subgraph 配置
    await updateSubgraphConfig(zwTokenAddress);

    // 启动 Graph Node
    await startGraphNode();
    graphNodeRunning = true;

    // 部署 Subgraph
    await deploySubgraph();
    subgraphDeployed = true;

    // 初始化 Apollo Client
    apolloClient = new ApolloClient({
      link: new HttpLink({ uri: GRAPHQL_ENDPOINT, fetch }),
      cache: new InMemoryCache(),
      defaultOptions: {
        query: {
          fetchPolicy: "network-only",
        },
      },
    });

    console.log("✅ Subgraph 环境已就绪");
  });

  after(async function () {
    console.log("\n" + "=".repeat(70));
    console.log("🧹 清理环境");
    console.log("=".repeat(70));

    if (graphNodeRunning) {
      await stopGraphNode();
    }

    console.log("✅ 清理完成");
  });

  it("完整流程：部署 → 交易 → Subgraph 索引 → GraphQL 查询 → Claim", async function () {
    console.log("\n" + "=".repeat(70));
    console.log("📝 真正的 Subgraph 集成测试");
    console.log("=".repeat(70));

    // ========== 阶段 1: 执行交易产生事件 ==========
    console.log("\n📌 阶段 1: Alice 和 Bob deposit");

    const depositAmount = ethers.parseEther("1000");
    await underlying
      .connect(alice)
      .approve(await zwToken.getAddress(), depositAmount);
    await zwToken.connect(alice).deposit(depositAmount);
    await underlying
      .connect(bob)
      .approve(await zwToken.getAddress(), depositAmount);
    await zwToken.connect(bob).deposit(depositAmount);

    console.log(
      `   ✅ Alice: ${ethers.formatEther(
        await zwToken.balanceOf(alice.address)
      )} ZWT`
    );
    console.log(
      `   ✅ Bob: ${ethers.formatEther(
        await zwToken.balanceOf(bob.address)
      )} ZWT`
    );

    // ========== 阶段 2: 创建隐私地址并转账 ==========
    console.log("\n📌 阶段 2: 创建隐私地址并转账");

    const secrets = [123456789n, 987654321n, 555555555n];
    const privacyData = [];
    let lastBlockNumber = 0;

    for (let i = 0; i < secrets.length; i++) {
      const secret = secrets[i];
      const addrScalar = poseidon([secret]);
      const addr20 = addrScalar & ((1n << 160n) - 1n);
      const q = (addrScalar - addr20) / (1n << 160n);
      const privacyAddress = ethers.getAddress(
        "0x" + addr20.toString(16).padStart(40, "0")
      );

      const amount = ethers.parseEther((300 - i * 50).toString());

      let tx;
      if (i < 2) {
        tx = await zwToken.connect(alice).transfer(privacyAddress, amount);
      } else {
        tx = await zwToken.connect(bob).transfer(privacyAddress, amount);
      }

      const receipt = await tx.wait();
      lastBlockNumber = receipt.blockNumber;

      privacyData.push({
        secret,
        addr20,
        q,
        address: privacyAddress,
        amount,
      });

      console.log(
        `   ✅ Commitment ${i + 1}: ${privacyAddress} (${ethers.formatEther(
          amount
        )} ZWT)`
      );
    }

    console.log(`   📍 最后交易区块: ${lastBlockNumber}`);

    // ========== 阶段 3: 等待 Subgraph 索引 ==========
    console.log("\n📌 阶段 3: 等待 Subgraph 索引完成");

    await waitForSubgraphSync(lastBlockNumber);

    // ========== 阶段 4: 通过 GraphQL 查询 Commitments ==========
    console.log("\n📌 阶段 4: 通过 GraphQL 查询 Commitments");

    console.log(`   🔍 查询端点: ${GRAPHQL_ENDPOINT}`);
    const commitments = await queryCommitments();

    console.log(`   📊 查询到 ${commitments.length} 个 commitments`);

    if (commitments.length === 0) {
      throw new Error("❌ Subgraph 没有返回任何数据！");
    }

    console.log("\n   📋 Commitment 列表:");
    commitments.forEach((c, i) => {
      console.log(
        `      [${i}] ${c.recipient}: ${ethers.formatEther(c.amount)} ZWT`
      );
    });

    // 验证数据完整性
    expect(commitments.length).to.equal(privacyData.length);
    console.log("   ✅ 数据数量匹配");

    // ========== 阶段 5: 使用 Subgraph 数据构建 Merkle Tree ==========
    console.log("\n📌 阶段 5: 使用 Subgraph 数据构建 Merkle Tree");

    const tree = new IncrementalMerkleTree(20);
    for (const commitment of commitments) {
      tree.insert(commitment.commitment);
    }

    const onchainRoot = await zwToken.root();
    const localRoot = "0x" + tree.root.toString(16).padStart(64, "0");

    console.log(`   📍 On-chain root: ${onchainRoot}`);
    console.log(`   📍 Local root:    ${localRoot}`);

    expect(localRoot).to.equal(onchainRoot);
    console.log("   ✅ Merkle root 验证通过");

    // ========== 阶段 6: 生成 ZK Proof ==========
    console.log("\n📌 阶段 6: 准备 Claim（使用第1个 commitment）");

    const targetData = privacyData[0];
    const targetCommitment = poseidon([
      targetData.addr20,
      BigInt(targetData.amount),
    ]);

    const commitmentIndex = tree.leaves.findIndex(
      (leaf) => BigInt(leaf) === targetCommitment
    );

    console.log(`   🎯 目标 commitment: ${commitmentIndex}`);
    console.log(
      `   💰 First amount: ${ethers.formatEther(targetData.amount)} ZWT`
    );

    const merkleProof = tree.getProof(commitmentIndex);
    console.log(`   ✅ Merkle proof 生成成功`);

    // 准备电路输入
    const nullifier = poseidon([targetData.addr20]);
    const claimAmount = ethers.parseEther("100");

    const circuitInput = {
      root: tree.root,
      nullifier: nullifier,
      to: BigInt(charlie.address),
      claimAmount: BigInt(claimAmount),
      secret: targetData.secret,
      addr20: targetData.addr20,
      firstAmount: BigInt(targetData.amount),
      q: targetData.q,
      pathElements: merkleProof.pathElements.map((e) => BigInt(e)),
      pathIndices: merkleProof.pathIndices,
    };

    console.log("   ⏳ 生成 ZK proof...");
    const { proof: zkProof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInput,
      wasmPath,
      zkeyPath
    );

    console.log("   ✅ ZK proof 生成成功!");

    // 格式化 proof
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

    // ========== 阶段 7: 执行 Claim ==========
    console.log("\n📌 阶段 7: 执行 Claim");

    const nullifierHex = "0x" + nullifier.toString(16).padStart(64, "0");

    const claimTx = await zwToken.claim(
      solidityProof.a,
      solidityProof.b,
      solidityProof.c,
      localRoot,
      nullifierHex,
      charlie.address,
      claimAmount
    );

    const receipt = await claimTx.wait();
    console.log(`   ✅ Claim 成功! Gas: ${receipt.gasUsed}`);

    const charlieBalance = await zwToken.balanceOf(charlie.address);
    expect(charlieBalance).to.equal(claimAmount);
    console.log(
      `   ✅ Charlie 余额: ${ethers.formatEther(charlieBalance)} ZWT`
    );

    // ========== 阶段 8: 验证 Subgraph 更新 ==========
    console.log("\n📌 阶段 8: 验证 Subgraph 自动更新");

    console.log("   ⏳ 等待新事件索引...");
    await waitForSubgraphSync(receipt.blockNumber);

    const updatedCommitments = await queryCommitments();
    console.log(`   📊 更新后的 commitments: ${updatedCommitments.length}`);

    expect(updatedCommitments.length).to.equal(commitments.length + 1);
    console.log("   ✅ Charlie 的新 commitment 已被索引");

    // ========== 总结 ==========
    console.log("\n" + "=".repeat(70));
    console.log("🎉 真正的 Subgraph 集成测试: PASSED!");
    console.log("=".repeat(70));

    console.log("\n📊 完整流程验证:");
    console.log("   1. ✅ 合约部署");
    console.log("   2. ✅ Graph Node 启动");
    console.log("   3. ✅ Subgraph 部署和索引");
    console.log("   4. ✅ GraphQL API 查询");
    console.log("   5. ✅ Merkle Tree 重建");
    console.log("   6. ✅ ZK Proof 生成");
    console.log("   7. ✅ Claim 执行");
    console.log("   8. ✅ Subgraph 自动更新");

    console.log("\n💡 这是真正的端到端 Subgraph 集成！");
    console.log("=".repeat(70));
  });
});
