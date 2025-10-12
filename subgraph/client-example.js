/**
 * 前端示例：使用 Subgraph 查询 Commitments 并构建 Merkle Tree
 *
 * 此示例展示如何：
 * 1. 从 subgraph 查询所有 commitments
 * 2. 构建完整的 Poseidon Merkle tree
 * 3. 生成特定叶子的 Merkle proof
 */

const { ApolloClient, InMemoryCache, gql } = require("@apollo/client");
const { buildPoseidon } = require("circomlibjs");
const { PoseidonMerkleTree } = require("../utils/merkle-tree-utils");

// ========== 配置 ==========

const SUBGRAPH_URL = "http://localhost:8000/subgraphs/name/zwtoken-subgraph"; // 本地开发
// const SUBGRAPH_URL = 'https://api.thegraph.com/subgraphs/name/<USERNAME>/zwtoken-subgraph'; // 生产环境

const TREE_DEPTH = 20;
const MAX_COMMITMENTS = 2 ** TREE_DEPTH; // 1,048,576

// ========== Apollo Client ==========

const client = new ApolloClient({
  uri: SUBGRAPH_URL,
  cache: new InMemoryCache(),
});

// ========== GraphQL 查询 ==========

const GET_ALL_COMMITMENTS = gql`
  query GetAllCommitments($first: Int!, $skip: Int!) {
    commitments(
      first: $first
      skip: $skip
      orderBy: index
      orderDirection: asc
    ) {
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

// Note: Count and Root should be queried from contract directly
// const count = await contract.getCommitmentCount();
// const root = await contract.root();

// ========== Subgraph 查询函数 ==========

/**
 * 查询所有 commitments（支持分页）
 */
async function fetchAllCommitments() {
  const PAGE_SIZE = 1000;
  let allCommitments = [];
  let skip = 0;
  let hasMore = true;

  console.log("正在从 subgraph 获取 commitments...");

  while (hasMore) {
    const { data } = await client.query({
      query: GET_ALL_COMMITMENTS,
      variables: {
        first: PAGE_SIZE,
        skip: skip,
      },
    });

    const commitments = data.commitments;
    allCommitments = allCommitments.concat(commitments);

    console.log(`已获取 ${allCommitments.length} 个 commitments...`);

    hasMore = commitments.length === PAGE_SIZE;
    skip += PAGE_SIZE;
  }

  console.log(`✓ 总共获取到 ${allCommitments.length} 个 commitments`);
  return allCommitments;
}

/**
 * 查询 commitment 总数（从合约）
 * @param {ethers.Contract} contract - ZWToken 合约实例
 */
async function fetchCommitmentCount(contract) {
  const count = await contract.getCommitmentCount();
  return Number(count);
}

/**
 * 查询最新的 Merkle root（从合约）
 * @param {ethers.Contract} contract - ZWToken 合约实例
 */
async function fetchLatestRoot(contract) {
  const root = await contract.root();
  return root;
}

// ========== Merkle Tree 构建 ==========

/**
 * 从 subgraph 数据构建 Merkle tree
 */
async function buildMerkleTreeFromSubgraph(commitments) {
  console.log("\n正在构建 Poseidon Merkle tree...");

  // 初始化 Poseidon
  const poseidon = await buildPoseidon();

  // 创建 Merkle tree
  const tree = new PoseidonMerkleTree(TREE_DEPTH, poseidon);

  // 按 index 排序（确保顺序正确）
  const sortedCommitments = commitments.sort(
    (a, b) => parseInt(a.index) - parseInt(b.index)
  );

  // 插入所有 commitments
  const leaves = sortedCommitments.map((c) => c.commitment);
  const finalRoot = tree.bulkInsert(leaves);

  console.log(`✓ Merkle tree 构建完成`);
  console.log(`  - 叶子节点数: ${tree.leaves.length}`);
  console.log(`  - 树深度: ${tree.depth}`);
  console.log(`  - 计算的 Root: 0x${finalRoot.toString(16)}`);

  return tree;
}

// ========== 主函数 ==========

async function main() {
  try {
    console.log("========== ZWToken Subgraph 客户端示例 ==========\n");

    // 1. 连接合约（需要 ethers.js）
    console.log("注意: 需要安装 ethers.js 并连接合约");
    console.log("const provider = new ethers.JsonRpcProvider(RPC_URL);");
    console.log(
      "const contract = new ethers.Contract(ADDRESS, ABI, provider);\n"
    );

    // 2. 从合约查询总数和 root
    console.log("从合约查询链上数据:");
    console.log("const count = await contract.getCommitmentCount();");
    console.log("const root = await contract.root();\n");

    // 3. 获取所有 commitments（从 Subgraph）
    const commitments = await fetchAllCommitments();

    if (commitments.length === 0) {
      console.log("没有找到任何 commitments");
      return;
    }

    // 4. 构建 Merkle tree
    const tree = await buildMerkleTreeFromSubgraph(commitments);

    // 5. 验证 root 是否匹配链上数据
    const calculatedRoot = "0x" + tree.root().toString(16);
    console.log(`\n计算的 Root: ${calculatedRoot}`);
    console.log("请使用 contract.root() 查询链上 Root 并进行比较\n");

    // 6. 生成示例 Merkle proof（第一个 commitment）
    if (commitments.length > 0) {
      console.log("\n========== Merkle Proof 示例 ==========\n");

      const exampleIndex = 0;
      const exampleCommitment = commitments[exampleIndex];

      console.log(`为 commitment #${exampleIndex} 生成 proof:`);
      console.log(`  Recipient: ${exampleCommitment.recipient}`);
      console.log(`  Amount: ${exampleCommitment.amount}`);
      console.log(`  Commitment: ${exampleCommitment.commitment}\n`);

      const proof = tree.generateProof(exampleIndex);

      console.log("生成的 Merkle Proof:");
      console.log(`  Root: ${proof.root}`);
      console.log(
        `  Path Elements: [${proof.pathElements.slice(0, 3).join(", ")}, ...]`
      );
      console.log(
        `  Path Indices: [${proof.pathIndices.slice(0, 3).join(", ")}, ...]`
      );

      // 7. 验证 proof
      const isValid = tree.verifyProof(
        proof.leaf,
        proof.pathElements,
        proof.pathIndices,
        proof.root
      );

      console.log(`\nProof 验证结果: ${isValid ? "✓ 有效" : "✗ 无效"}`);
    }

    console.log("\n========== 完成 ==========");
  } catch (error) {
    console.error("错误:", error);
    throw error;
  }
}

// ========== 导出 ==========

module.exports = {
  fetchAllCommitments,
  fetchCommitmentCount,
  fetchLatestRoot,
  buildMerkleTreeFromSubgraph,
};

// 如果直接运行此脚本
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
