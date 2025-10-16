/**
 * 合约地址配置
 * 来自 deploy_log.txt
 */

export const CONTRACT_ADDRESSES = {
  // ZWToken 主合约
  ZWToken: '0x8913094084839c03E7753A15FF6CC7E4Bcb7E11B',
  
  // 底层代币 (USDC)
  UnderlyingToken: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  
  // Groth16 验证器
  Verifier: '0xdAAAa905B017Fb45764d3F1210d9a0eb84D6588E',
  
  // PoseidonT3 库
  PoseidonT3: '0x5411AFc40f77201b34F50F17Ff2215440BE02C80',
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
  ],
  
  // ZWToken 合约
  ZWToken: [
    'function deposit(uint256 amount) external',
    'function withdraw(uint256 amount) external',
    'function transfer(address to, uint256 amount) external returns (bool)',
    'function claim(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, bytes32 root, bytes32 nullifier, address to, uint256 amount) external',
    'function balanceOf(address account) external view returns (uint256)',
    'function getCommitmentCount() external view returns (uint256)',
    'function getLeafRange(uint256 startIndex, uint256 length) external view returns (tuple(address to, uint256 amount)[] memory)',
    'function getStoredLeafCount() external view returns (uint256)',
    'function root() external view returns (bytes32)',
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

