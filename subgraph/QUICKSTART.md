# Subgraph 快速入门指南

## 📋 前置条件

1. ✅ ZWToken 合约已部署
2. ✅ Node.js >= 16.0.0
3. ✅ Graph CLI 已安装（或通过 npm 安装）

## 🚀 5 分钟快速部署

### 步骤 1: 安装依赖

```bash
cd subgraph
npm install
```

### 步骤 2: 准备 ABI 文件

从项目根目录运行：

```bash
# 方法 1: 使用 npm 脚本（推荐）
npm run subgraph:copy-abi

# 方法 2: 手动复制
mkdir -p subgraph/abis
cp artifacts/contracts/ZWToken.sol/ZWToken.json subgraph/abis/
```

### 步骤 3: 更新配置

编辑 `subgraph.yaml` 或使用配置脚本：

```bash
# 方法 1: 使用脚本（推荐）
./scripts/update-config.sh <network> <address> <startBlock>

# 示例
./scripts/update-config.sh sepolia 0x1234567890123456789012345678901234567890 1234567

# 方法 2: 手动编辑
# 编辑 subgraph.yaml，更新以下字段：
# - network: mainnet/sepolia/localhost
# - address: 合约地址
# - startBlock: 起始区块号
```

### 步骤 4: 生成代码

```bash
npm run codegen
```

这将生成：

- `generated/ZWToken/ZWToken.ts` - 合约类型定义
- `generated/schema.ts` - GraphQL schema 类型

### 步骤 5: 构建 Subgraph

```bash
npm run build
```

### 步骤 6: 部署

#### 选项 A: 部署到本地 Graph 节点（开发）

```bash
# 首次部署需要先创建
npm run create:local

# 部署
npm run deploy:local
```

#### 选项 B: 部署到 The Graph 托管服务（生产）

```bash
# 1. 在 https://thegraph.com/hosted-service/ 创建账号和 subgraph

# 2. 获取访问令牌并认证
graph auth --product hosted-service <ACCESS_TOKEN>

# 3. 更新 subgraph.yaml 中的 subgraph 名称
# 将 "zwtoken-subgraph" 改为你的 "<GITHUB_USER>/<SUBGRAPH_NAME>"

# 4. 部署
npm run deploy
```

## 🧪 测试 Subgraph

部署成功后，访问 GraphQL Playground：

- **本地**: http://localhost:8000/subgraphs/name/zwtoken-subgraph/graphql
- **托管服务**: https://thegraph.com/hosted-service/subgraph/\<USERNAME\>/zwtoken-subgraph

### 测试查询

```graphql
# 查询前 10 个 commitments
{
  commitments(first: 10, orderBy: index) {
    id
    commitment
    index
    recipient
    amount
  }
}
```

**注意**: Commitment 总数和 Root 应该从合约直接查询：

```javascript
// 使用 ethers.js
const count = await contract.getCommitmentCount();
const root = await contract.root();
```

## 📱 前端集成

### 混合查询模式（推荐）

前端需要同时连接 Subgraph 和合约：

```bash
npm install @apollo/client graphql ethers
```

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

// 3. 查询 commitments（从 Subgraph - 高效、无 gas）
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

// 4. 查询状态（从合约 - 实时、准确）
const currentRoot = await contract.root();
const commitmentCount = await contract.getCommitmentCount();

console.log(`Subgraph 索引: ${data.commitments.length} 个 commitments`);
console.log(`合约总数: ${commitmentCount}`);
console.log(`当前 Root: ${currentRoot}`);
```

### 方法 2: 使用 fetch

```javascript
const SUBGRAPH_URL = "http://localhost:8000/subgraphs/name/zwtoken-subgraph";

async function queryCommitments() {
  const response = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `
        query {
          commitments(first: 1000, orderBy: index) {
            commitment
            index
          }
        }
      `,
    }),
  });

  const { data } = await response.json();
  return data.commitments;
}
```

## 🌲 构建 Merkle Tree

使用查询到的 commitments 构建 Merkle tree：

```javascript
import { buildPoseidon } from "circomlibjs";

async function buildMerkleTree(commitments) {
  const poseidon = await buildPoseidon();

  // 使用 subgraph/client-example.js 中的 PoseidonMerkleTree 类
  const tree = new PoseidonMerkleTree(20, poseidon);

  // 按 index 排序并插入
  const sorted = commitments.sort(
    (a, b) => parseInt(a.index) - parseInt(b.index)
  );

  for (const c of sorted) {
    tree.insert(c.commitment);
  }

  return tree;
}

// 生成 Merkle proof
const proof = tree.generateProof(leafIndex);
```

## 🔧 故障排除

### 问题 1: "ABI file not found"

**解决方案**: 确保已编译合约并复制 ABI

```bash
npm run compile
npm run subgraph:copy-abi
```

### 问题 2: "Failed to connect to Graph Node"

**解决方案**: 确保 Graph 节点正在运行

```bash
# 检查本地 Graph 节点是否运行
curl http://localhost:8020

# 如果没有运行，参考 Graph 节点部署文档:
# https://github.com/graphprotocol/graph-node
```

### 问题 3: "Subgraph build failed"

**解决方案**:

1. 确保 `subgraph.yaml` 配置正确
2. 检查网络配置是否匹配
3. 验证合约地址格式

```bash
# 清理并重新构建
rm -rf build/ generated/
npm run codegen
npm run build
```

### 问题 4: "No commitments found"

**解决方案**:

1. 检查合约是否有 commitments
2. 验证 `startBlock` 配置
3. 等待 subgraph 同步完成

```graphql
# 检查同步状态
{
  _meta {
    block {
      number
    }
    hasIndexingErrors
  }
}
```

## 📚 更多资源

- [完整文档](README.md)
- [查询示例](examples/query-examples.graphql)
- [React 集成示例](examples/react-integration.jsx)
- [客户端示例](client-example.js)

## 🆘 需要帮助？

1. 查看 [The Graph 官方文档](https://thegraph.com/docs/)
2. 参考 [AssemblyScript 文档](https://www.assemblyscript.org/)
3. 检查 [示例代码](examples/)

---

**🎉 完成！你的 Subgraph 现在可以使用了！**

下一步：

- ✅ 在前端集成 subgraph 查询
- ✅ 构建 Merkle tree 并生成 proof
- ✅ 使用 proof 调用 `claim()` 函数
