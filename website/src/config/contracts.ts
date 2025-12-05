/**
 * 合约地址配置
 * 来自 deploy_log.txt
 */

export const CONTRACT_ADDRESSES = {
  // ZWToken 主合约 (ZWERC20 实现)
  ZWERC20: '0xFdb64908218B900585571218a77a0a1B47c537e7',

  // 底层代币 (USDC)
  UnderlyingToken: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',

  // Groth16 验证器
  Verifier: '0xaB165da0aB5D12C0D75ff49b53319fff60140C51',

  // PoseidonT3 库
  PoseidonT3: '0xABCEffcB2b5fD8958A9358eC6c218F91b7bA0A62',
} as const;

/**
 * 合约 ABI 定义
 */
export const CONTRACT_ABIS = {
  // ERC20 基础功能
  ERC20: [
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function allowance(address owner, address spender) external view returns (uint256)',
    'function balanceOf(address account) external view returns (uint256)',
    'function transfer(address to, uint256 amount) external returns (bool)',
    'function decimals() external view returns (uint8)',
  ],

  // ZWToken 合约 (ZWERC20 实现，IERC8065 标准)
  ZWERC20: [
    'function deposit(address to, uint256 id, uint256 amount) external payable',
    'function withdraw(address to, uint256 id, uint256 amount) external',
    'function remint(address to, uint256 id, uint256 amount, bool withdrawUnderlying, tuple(bytes32 commitment, bytes32[] nullifiers, bytes proverData, bytes relayerData, bytes proof) data) external',
    'function transfer(address to, uint256 amount) external returns (bool)',
    'function balanceOf(address account) external view returns (uint256)',
    'function root() external view returns (bytes32)',
    'function getCommitLeafCount(uint256 id) external view returns (uint256)',
    'function getCommitLeaves(uint256 id, uint256 startIndex, uint256 length) external view returns (bytes32[] memory commitHashes, address[] memory recipients, uint256[] memory amounts)',
    'function getLatestCommitment(uint256 id) external view returns (bytes32)',
    'function hasCommitment(uint256 id, bytes32 commitment) external view returns (bool)',
    'function hasFirstReceiptRecorded(address account) external view returns (bool)',
    'function nullifierUsed(bytes32 nullifier) external view returns (bool)',
  ],
} as const;

/**
 * 代币信息
 */
export const TOKEN_INFO = {
  name: 'Zero Knowledge Wrapper USDC',
  symbol: 'ZWUSDC',
  underlyingName: 'USDC',
  underlyingSymbol: 'USDC',
} as const;
