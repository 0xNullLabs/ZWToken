/**
 * React 集成示例：使用 Apollo Client 查询 Subgraph 并构建 Merkle Tree
 *
 * 安装依赖:
 * npm install @apollo/client graphql circomlibjs
 */

import React, { useState, useEffect } from "react";
import { ApolloClient, InMemoryCache, gql, useQuery } from "@apollo/client";
import { buildPoseidon } from "circomlibjs";

// ========== Apollo Client 配置 ==========

const client = new ApolloClient({
  uri: "http://localhost:8000/subgraphs/name/zwtoken-subgraph",
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

// Note: Commitment count should be queried from contract
// const count = await contract.getCommitmentCount();

// ========== Merkle Tree 类 ==========

class PoseidonMerkleTree {
  constructor(depth, poseidon) {
    this.depth = depth;
    this.poseidon = poseidon;

    // 初始化零值哈希
    this.zeros = [];
    let currentZero = BigInt(0);
    this.zeros.push(currentZero);

    for (let i = 1; i < depth; i++) {
      const hash = this.hash(currentZero, currentZero);
      currentZero = BigInt(hash);
      this.zeros.push(currentZero);
    }

    this.leaves = [];
    this.filledSubtrees = new Array(depth);
    for (let i = 0; i < depth; i++) {
      this.filledSubtrees[i] = this.zeros[i];
    }
  }

  hash(left, right) {
    const result = this.poseidon([BigInt(left), BigInt(right)]);
    return this.poseidon.F.toString(result);
  }

  insert(leaf) {
    const index = this.leaves.length;
    if (index >= 2 ** this.depth) {
      throw new Error("Merkle tree is full");
    }

    this.leaves.push(BigInt(leaf));

    let currentHash = BigInt(leaf);
    let currentIndex = index;

    for (let i = 0; i < this.depth; i++) {
      if (currentIndex % 2 === 0) {
        this.filledSubtrees[i] = currentHash;
        currentHash = BigInt(this.hash(currentHash, this.zeros[i]));
      } else {
        currentHash = BigInt(this.hash(this.filledSubtrees[i], currentHash));
      }
      currentIndex = Math.floor(currentIndex / 2);
    }

    return currentHash;
  }

  root() {
    if (this.leaves.length === 0) {
      return this.zeros[this.depth - 1];
    }

    let currentHash = this.filledSubtrees[0];
    let currentIndex = this.leaves.length;

    for (let i = 0; i < this.depth; i++) {
      if (currentIndex % 2 === 0) {
        currentHash = BigInt(this.hash(currentHash, this.zeros[i]));
      } else {
        currentHash = BigInt(this.hash(this.filledSubtrees[i], currentHash));
      }
      currentIndex = Math.floor(currentIndex / 2);
    }

    return currentHash;
  }

  generateProof(leafIndex) {
    if (leafIndex >= this.leaves.length) {
      throw new Error("Leaf index out of bounds");
    }

    const pathElements = [];
    const pathIndices = [];
    let currentIndex = leafIndex;

    for (let i = 0; i < this.depth; i++) {
      const isLeft = currentIndex % 2 === 0;

      if (isLeft) {
        const sibling =
          currentIndex + 1 < this.leaves.length && i === 0
            ? this.leaves[currentIndex + 1]
            : this.zeros[i];
        pathElements.push(sibling.toString());
        pathIndices.push(0);
      } else {
        const sibling = this.filledSubtrees[i];
        pathElements.push(sibling.toString());
        pathIndices.push(1);
      }

      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      pathElements,
      pathIndices,
      root: this.root().toString(),
      leaf: this.leaves[leafIndex].toString(),
    };
  }
}

// ========== React Hooks ==========

/**
 * 获取所有 Commitments 的 Hook
 */
function useAllCommitments() {
  const [commitments, setCommitments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchAll() {
      try {
        setLoading(true);
        const PAGE_SIZE = 1000;
        let allCommitments = [];
        let skip = 0;
        let hasMore = true;

        while (hasMore) {
          const { data } = await client.query({
            query: GET_ALL_COMMITMENTS,
            variables: { first: PAGE_SIZE, skip },
          });

          const items = data.commitments;
          allCommitments = allCommitments.concat(items);
          hasMore = items.length === PAGE_SIZE;
          skip += PAGE_SIZE;
        }

        setCommitments(allCommitments);
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    }

    fetchAll();
  }, []);

  return { commitments, loading, error };
}

/**
 * 构建 Merkle Tree 的 Hook
 */
function useMerkleTree(commitments) {
  const [tree, setTree] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function buildTree() {
      if (commitments.length === 0) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const poseidon = await buildPoseidon();
        const merkleTree = new PoseidonMerkleTree(20, poseidon);

        const sortedCommitments = commitments.sort(
          (a, b) => parseInt(a.index) - parseInt(b.index)
        );

        for (const c of sortedCommitments) {
          merkleTree.insert(c.commitment);
        }

        setTree(merkleTree);
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    }

    buildTree();
  }, [commitments]);

  return { tree, loading, error };
}

// ========== React 组件 ==========

/**
 * 主组件：显示 Commitments 和 Merkle Tree 信息
 */
export function ZWTokenMerkleTreeViewer() {
  const {
    commitments,
    loading: commitmentsLoading,
    error: commitmentsError,
  } = useAllCommitments();
  const {
    tree,
    loading: treeLoading,
    error: treeError,
  } = useMerkleTree(commitments);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [proof, setProof] = useState(null);
  const [contractData, setContractData] = useState({ count: 0, root: null });

  // Fetch contract data (count and root)
  useEffect(() => {
    async function fetchContractData() {
      // TODO: Replace with actual ethers.js calls
      // const provider = new ethers.JsonRpcProvider(RPC_URL);
      // const contract = new ethers.Contract(ADDRESS, ABI, provider);
      // const count = await contract.getCommitmentCount();
      // const root = await contract.root();
      // setContractData({ count: Number(count), root });

      // For demo purposes, use commitments length
      setContractData({
        count: commitments.length,
        root: tree ? "0x" + tree.root().toString(16) : null,
      });
    }

    if (tree && commitments.length > 0) {
      fetchContractData();
    }
  }, [tree, commitments]);

  const handleGenerateProof = () => {
    if (tree && selectedIndex >= 0 && selectedIndex < commitments.length) {
      const generatedProof = tree.generateProof(selectedIndex);
      setProof(generatedProof);
    }
  };

  if (commitmentsLoading || treeLoading) {
    return (
      <div className="loading">
        <p>正在加载 Commitments 并构建 Merkle Tree...</p>
      </div>
    );
  }

  if (commitmentsError || treeError) {
    return (
      <div className="error">
        <p>错误: {(commitmentsError || treeError)?.message}</p>
      </div>
    );
  }

  return (
    <div className="merkle-tree-viewer">
      <h1>ZWToken Merkle Tree Viewer</h1>

      {/* 统计信息 */}
      <section className="stats">
        <h2>统计信息</h2>
        <div className="stat-grid">
          <div className="stat-item">
            <span className="label">Commitments 总数 (合约):</span>
            <span className="value">{contractData.count}</span>
          </div>
          <div className="stat-item">
            <span className="label">已索引:</span>
            <span className="value">{commitments.length}</span>
          </div>
          <div className="stat-item">
            <span className="label">树深度:</span>
            <span className="value">20</span>
          </div>
          <div className="stat-item">
            <span className="label">当前 Root (合约):</span>
            <span className="value hash">
              {contractData.root || "请连接合约查询"}
            </span>
          </div>
        </div>
        <div className="info-note">
          💡 提示: Root 和总数应从合约直接查询 (contract.root() 和
          contract.getCommitmentCount())
        </div>
      </section>

      {/* Commitments 列表 */}
      <section className="commitments">
        <h2>Commitments</h2>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Index</th>
                <th>Commitment</th>
                <th>Recipient</th>
                <th>Amount</th>
                <th>Block</th>
              </tr>
            </thead>
            <tbody>
              {commitments.slice(0, 20).map((c) => (
                <tr key={c.id}>
                  <td>{c.index}</td>
                  <td className="hash">
                    {c.commitment.slice(0, 10)}...{c.commitment.slice(-8)}
                  </td>
                  <td className="address">
                    {c.recipient.slice(0, 8)}...{c.recipient.slice(-6)}
                  </td>
                  <td>{c.amount}</td>
                  <td>{c.blockNumber}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {commitments.length > 20 && (
            <p className="note">显示前 20 条记录，共 {commitments.length} 条</p>
          )}
        </div>
      </section>

      {/* Merkle Proof 生成器 */}
      <section className="proof-generator">
        <h2>Merkle Proof 生成器</h2>
        <div className="input-group">
          <label>
            选择 Commitment Index:
            <input
              type="number"
              min="0"
              max={commitments.length - 1}
              value={selectedIndex}
              onChange={(e) => setSelectedIndex(parseInt(e.target.value))}
            />
          </label>
          <button onClick={handleGenerateProof} disabled={!tree}>
            生成 Proof
          </button>
        </div>

        {proof && (
          <div className="proof-result">
            <h3>生成的 Merkle Proof:</h3>
            <div className="proof-field">
              <strong>Leaf:</strong>
              <code>{proof.leaf}</code>
            </div>
            <div className="proof-field">
              <strong>Root:</strong>
              <code>{proof.root}</code>
            </div>
            <div className="proof-field">
              <strong>Path Elements:</strong>
              <pre>
                {JSON.stringify(proof.pathElements.slice(0, 3), null, 2)}... (共
                20 个)
              </pre>
            </div>
            <div className="proof-field">
              <strong>Path Indices:</strong>
              <pre>{JSON.stringify(proof.pathIndices)}</pre>
            </div>
            <button
              onClick={() =>
                navigator.clipboard.writeText(JSON.stringify(proof, null, 2))
              }
            >
              复制到剪贴板
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

// ========== 样式 (CSS) ==========

const styles = `
.merkle-tree-viewer {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

.loading, .error {
  text-align: center;
  padding: 40px;
}

.error p {
  color: #d32f2f;
}

section {
  margin-bottom: 40px;
  padding: 20px;
  background: #f5f5f5;
  border-radius: 8px;
}

h1 {
  color: #1976d2;
}

h2 {
  margin-top: 0;
  color: #424242;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 15px;
}

.stat-item {
  display: flex;
  justify-content: space-between;
  padding: 10px;
  background: white;
  border-radius: 4px;
}

.hash, .address {
  font-family: 'Courier New', monospace;
  font-size: 0.9em;
}

table {
  width: 100%;
  border-collapse: collapse;
  background: white;
}

th, td {
  padding: 12px;
  text-align: left;
  border-bottom: 1px solid #ddd;
}

th {
  background: #1976d2;
  color: white;
}

.input-group {
  display: flex;
  gap: 15px;
  align-items: flex-end;
}

label {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

input, button {
  padding: 10px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 14px;
}

button {
  background: #1976d2;
  color: white;
  cursor: pointer;
  border: none;
}

button:hover {
  background: #1565c0;
}

button:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.proof-result {
  margin-top: 20px;
  padding: 15px;
  background: white;
  border-radius: 4px;
}

.proof-field {
  margin-bottom: 15px;
}

code, pre {
  background: #f5f5f5;
  padding: 5px;
  border-radius: 3px;
  display: block;
  overflow-x: auto;
}
`;

export default ZWTokenMerkleTreeViewer;
