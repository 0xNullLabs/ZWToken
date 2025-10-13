// ZWToken 合约配置
export const CONTRACT_CONFIG = {
  // TODO: 部署后替换为实际的合约地址
  address: '0x0000000000000000000000000000000000000000',
  
  // ZWToken 合约 ABI
  abi: [
    // Deposit 函数
    'function deposit(uint256 amount) external',
    
    // Transfer 函数
    'function transfer(address to, uint256 amount) external returns (bool)',
    
    // Claim 函数
    'function claim(uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256 root, uint256 nullifier, address recipient, uint256 claimAmount) external',
    
    // 查询函数
    'function balanceOf(address account) external view returns (uint256)',
    'function getCommitmentCount() external view returns (uint256)',
    'function root() external view returns (uint256)',
    
    // 事件
    'event CommitmentAdded(uint256 indexed commitment, uint256 index)',
    'event Claimed(address indexed recipient, uint256 amount, uint256 nullifier)',
  ],
};

// RPC 配置
export const RPC_CONFIG = {
  mainnet: 'https://mainnet.infura.io/v3/YOUR_INFURA_KEY',
  sepolia: 'https://sepolia.infura.io/v3/YOUR_INFURA_KEY',
  localhost: 'http://localhost:8545',
};

