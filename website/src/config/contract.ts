// ZWToken Contract Configuration
export const CONTRACT_CONFIG = {
  // TODO: Replace with actual contract address after deployment
  address: '0x0000000000000000000000000000000000000000',

  // ZWToken contract ABI (IERC8065)
  abi: [
    // IERC8065 core functions
    'function deposit(address to, uint256 id, uint256 amount) external payable',
    'function withdraw(address to, uint256 id, uint256 amount) external',
    'function remint(address to, uint256 id, uint256 amount, bool withdrawUnderlying, tuple(bytes32 commitment, bytes32[] nullifiers, bytes proverData, bytes relayerData, bytes proof) data) external',

    // Transfer function
    'function transfer(address to, uint256 amount) external returns (bool)',

    // Query functions
    'function balanceOf(address account) external view returns (uint256)',
    'function getCommitLeafCount(uint256 id) external view returns (uint256)',
    'function getCommitLeaves(uint256 id, uint256 startIndex, uint256 length) external view returns (bytes32[] memory commitHashes, address[] memory recipients, uint256[] memory amounts)',
    'function getLatestCommitment(uint256 id) external view returns (bytes32)',

    // Events
    'event CommitmentUpdated(uint256 indexed id, bytes32 indexed commitment, address indexed to, uint256 amount)',
    'event Deposited(address indexed from, address indexed to, uint256 indexed id, uint256 amount)',
    'event Withdrawn(address indexed from, address indexed to, uint256 indexed id, uint256 amount)',
    'event Reminted(address indexed from, address indexed to, uint256 indexed id, uint256 amount, bool withdrawUnderlying)',
  ],
};

// RPC Configuration
export const RPC_CONFIG = {
  mainnet: 'https://mainnet.infura.io/v3/YOUR_INFURA_KEY',
  sepolia: 'https://sepolia.infura.io/v3/YOUR_INFURA_KEY',
  localhost: 'http://localhost:8545',
};
