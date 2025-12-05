// ZWToken 合约配置
export const CONTRACT_CONFIG = {
  // TODO: 部署后替换为实际的合约地址
  address: '0x0000000000000000000000000000000000000000',

  // ZWToken 合约 ABI (IERC8065)
  abi: [
    // IERC8065 核心函数
    'function deposit(address to, uint256 id, uint256 amount) external payable',
    'function withdraw(address to, uint256 id, uint256 amount) external',
    'function remint(address to, uint256 id, uint256 amount, bool withdrawUnderlying, tuple(bytes32 commitment, bytes32[] nullifiers, bytes proverData, bytes relayerData, bytes proof) data) external',

    // Transfer 函数
    'function transfer(address to, uint256 amount) external returns (bool)',

    // 查询函数
    'function balanceOf(address account) external view returns (uint256)',
    'function getCommitLeafCount(uint256 id) external view returns (uint256)',
    'function getCommitLeaves(uint256 id, uint256 startIndex, uint256 length) external view returns (bytes32[] memory commitHashes, address[] memory recipients, uint256[] memory amounts)',
    'function getLatestCommitment(uint256 id) external view returns (bytes32)',

    // 事件
    'event CommitmentUpdated(uint256 indexed id, bytes32 indexed commitment, address indexed to, uint256 amount)',
    'event Deposited(address indexed from, address indexed to, uint256 indexed id, uint256 amount)',
    'event Withdrawn(address indexed from, address indexed to, uint256 indexed id, uint256 amount)',
    'event Reminted(address indexed from, address indexed to, uint256 indexed id, uint256 amount, bool withdrawUnderlying)',
  ],
};

// RPC 配置
export const RPC_CONFIG = {
  mainnet: 'https://mainnet.infura.io/v3/YOUR_INFURA_KEY',
  sepolia: 'https://sepolia.infura.io/v3/YOUR_INFURA_KEY',
  localhost: 'http://localhost:8545',
};
