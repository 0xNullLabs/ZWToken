require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: "0.8.20",
  networks: {
    hardhat: {
      // 默认本地测试，不 fork
    },
    // 连接到 Anvil 或其他本地节点（支持 eth_getProof）
    localhost: {
      url: "http://127.0.0.1:8545"
    },
    // Fork 模式：使用真实网络进行测试（需要先设置环境变量）
    // 取消注释以启用
    // "hardhat-fork": {
    //   forking: {
    //     url: process.env.MAINNET_RPC_URL || "https://eth-mainnet.g.alchemy.com/v2/demo",
    //     blockNumber: 18000000  // 可选：固定到特定区块
    //   }
    // },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  }
};
