/**
 * 合约地址配置
 * 来自 deploy_log.txt
 */

export const CONTRACT_ADDRESSES = {
  // ZWToken 主合约 (ZWERC20 实现)
  ZWERC20: '0xFaA20C4D2c30eC24d924Fb8E2c5089F986F30567',
  
  // 底层代币 (USDC)
  UnderlyingToken: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  
  // Groth16 验证器
  Verifier: '0xAf5F32a63e23A3E39f0b87586319FAC18995792a',
  
  // PoseidonT3 库
  PoseidonT3: '0x45F66B102f5768f96d623b58AEf1Ff9650C81678',
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
    'function depositTo(address to, uint256 id, uint256 amount) external payable',
    'function withdraw(address to, uint256 id, uint256 amount) external',
    'function remint(bytes calldata proof, bytes32 commitment, bytes32 nullifier, address to, uint256 id, uint256 amount, bool withdrawUnderlying, uint256 relayerFee) external',
    'function transfer(address to, uint256 amount) external returns (bool)',
    'function balanceOf(address account) external view returns (uint256)',
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

