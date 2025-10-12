# ZWToken Subgraph

此 Subgraph 用于索引 ZWToken 合约的所有 `CommitmentAdded` 事件，供前端查询并构建完整的默克尔树。

## 功能

- **索引所有 Commitments**: 记录每个 commitment 的详细信息（commitment hash、index、recipient、amount、区块信息等）
- **高效查询**: 支持按地址、区块、时间范围等条件查询
- **实时更新**: 自动同步新的 commitments

> **设计理念**: Subgraph 只索引事件数据，Root 和 Count 等状态变量直接从合约查询，避免数据冗余

## 数据模型

### Commitment

- `id`: Commitment hash (唯一标识)
- `commitment`: Commitment hash (bytes32)
- `index`: Merkle tree 中的索引位置
- `recipient`: 接收者地址
- `amount`: 首次接收金额
- `blockNumber`: 区块号
- `blockTimestamp`: 区块时间戳
- `transactionHash`: 交易哈希

> **注意**: Commitment 总数和最新的 Merkle root 可以直接从合约查询：
>
> - 总数: 调用合约的 `nextIndex()` 或 `getCommitmentCount()`
> - Root: 调用合约的 `root()`

## 部署步骤

### 1. 准备 ABI 文件

首先需要将合约 ABI 复制到 subgraph 目录：

```bash
mkdir -p subgraph/abis
cp artifacts/contracts/ZWToken.sol/ZWToken.json subgraph/abis/
```

### 2. 更新配置

编辑 `subgraph.yaml`，更新以下内容：

- `network`: 部署的网络名称（如 `mainnet`, `sepolia`, `localhost`）
- `address`: ZWToken 合约的实际部署地址
- `startBlock`: 合约部署的起始区块号

### 3. 安装依赖

```bash
cd subgraph
npm install
```

### 4. 生成代码

```bash
npm run codegen
```

此命令会根据 ABI 和 schema 生成 TypeScript 类型定义。

### 5. 构建 Subgraph

```bash
npm run build
```

### 6. 部署到本地 Graph 节点（开发环境）

如果你在本地运行 Graph 节点：

```bash
# 首次创建
npm run create:local

# 部署
npm run deploy:local
```

### 7. 部署到 The Graph 托管服务

```bash
# 需要先在 https://thegraph.com/ 创建 subgraph
graph auth --product hosted-service <ACCESS_TOKEN>
npm run deploy
```

## 前端查询示例

### 查询所有 Commitments（按 index 排序）

```graphql
query GetAllCommitments {
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
```

### 查询特定地址的 Commitment

```graphql
query GetCommitmentsByRecipient($recipient: Bytes!) {
  commitments(where: { recipient: $recipient }) {
    id
    commitment
    index
    amount
    blockNumber
    blockTimestamp
  }
}
```

### 查询总数（从合约）

```javascript
// 使用 ethers.js 直接查询合约
const count = await zwTokenContract.getCommitmentCount();
// 或
const nextIndex = await zwTokenContract.nextIndex();
```

### 查询当前 Root（从合约）

```javascript
// 使用 ethers.js 直接查询合约
const currentRoot = await zwTokenContract.root();
```

### 分页查询（构建完整树）

```graphql
query GetCommitmentsPaginated($skip: Int!, $first: Int!) {
  commitments(skip: $skip, first: $first, orderBy: index, orderDirection: asc) {
    id
    commitment
    index
    recipient
    amount
  }
}
```

## 前端构建 Merkle Tree

前端可以通过以下步骤构建完整的 Merkle tree：

```javascript
import { buildPoseidon } from "circomlibjs";
import { ethers } from "ethers";

// 1. 查询所有 commitments（从 Subgraph）
const { data } = await apolloClient.query({
  query: gql`
    query {
      commitments(first: 1000, orderBy: index, orderDirection: asc) {
        commitment
        index
      }
    }
  `,
});

// 2. 查询链上数据（从合约）
const provider = new ethers.JsonRpcProvider(RPC_URL);
const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

const currentRoot = await contract.root();
const commitmentCount = await contract.getCommitmentCount();

console.log(`链上 Root: ${currentRoot}`);
console.log(`Commitment 总数: ${commitmentCount}`);

// 3. 构建本地 Merkle tree（使用 Subgraph 数据）
async function buildMerkleTree(commitments) {
  const poseidon = await buildPoseidon();
  const TREE_DEPTH = 20;

  // 初始化零值哈希
  const zeros = [];
  let currentZero = BigInt(0);
  zeros.push(currentZero);

  for (let i = 1; i < TREE_DEPTH; i++) {
    currentZero = poseidon.F.toString(poseidon([currentZero, currentZero]));
    zeros.push(BigInt(currentZero));
  }

  // 按 index 排序并构建树
  const sortedCommitments = commitments.sort(
    (a, b) => parseInt(a.index) - parseInt(b.index)
  );

  const leaves = sortedCommitments.map((c) => BigInt(c.commitment));

  // ... 构建完整的 Merkle tree

  return merkleTree;
}

// 4. 验证构建的树与链上 root 一致
const tree = await buildMerkleTree(data.commitments);
const calculatedRoot = tree.root();
console.log(`计算的 Root: ${calculatedRoot}`);
console.log(`Root 匹配: ${calculatedRoot === currentRoot}`);

// 5. 生成 Merkle proof
function generateMerkleProof(merkleTree, leafIndex) {
  // 返回 pathElements 和 pathIndices
  // 用于 ZK 电路的 Merkle proof 验证
  return merkleTree.generateProof(leafIndex);
}
```

## 本地开发环境

如果需要在本地测试 subgraph，可以使用 Docker 运行 Graph 节点：

```bash
# 克隆 graph-node 仓库
git clone https://github.com/graphprotocol/graph-node.git
cd graph-node/docker

# 启动服务（需要修改 docker-compose.yml 中的 ethereum 配置）
docker-compose up
```

然后将 `ethereum` 配置指向你的本地节点（如 Hardhat 或 Anvil）。

## 注意事项

1. **混合查询模式**:

   - 历史事件数据（commitments）→ Subgraph 查询（高效、无 gas）
   - 当前状态数据（root、count）→ 合约查询（实时、准确）

2. **数据一致性**: Subgraph 可能有几秒到几分钟的延迟，取决于网络和索引速度

3. **Root 验证**: 使用 Subgraph 数据构建 Merkle tree 后，务必与合约的 `root()` 进行验证

4. **分页查询**: 如果 commitment 数量很大，使用分页查询避免超时

5. **本地缓存**: 前端可以缓存已构建的 Merkle tree，只增量更新新的 commitment

## 与前端集成

前端需要同时连接 Subgraph 和合约：

```javascript
import { ApolloClient, InMemoryCache, gql } from "@apollo/client";
import { ethers } from "ethers";

// 1. 连接 Subgraph（查询历史事件）
const apolloClient = new ApolloClient({
  uri: "http://localhost:8000/subgraphs/name/zwtoken-subgraph",
  cache: new InMemoryCache(),
});

// 2. 连接合约（查询当前状态）
const provider = new ethers.JsonRpcProvider(RPC_URL);
const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

// 3. 查询 commitments（从 Subgraph）
const { data } = await apolloClient.query({
  query: gql`
    query {
      commitments(first: 1000, orderBy: index) {
        commitment
        index
      }
    }
  `,
});

// 4. 查询 root 和 count（从合约）
const currentRoot = await contract.root();
const commitmentCount = await contract.getCommitmentCount();

// 5. 构建并验证 Merkle tree
const tree = buildMerkleTree(data.commitments);
const calculatedRoot = tree.root();
console.assert(calculatedRoot === currentRoot, "Root mismatch!");
```

## 监控和维护

- 监控 subgraph 同步状态
- 定期检查索引是否正常
- 如果合约升级，需要更新 subgraph 配置并重新部署

## 相关资源

- [The Graph 文档](https://thegraph.com/docs/)
- [AssemblyScript 文档](https://www.assemblyscript.org/)
- [GraphQL 查询文档](https://graphql.org/learn/)
