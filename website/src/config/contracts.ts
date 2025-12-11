/**
 * Contract Address Configuration
 * From deployment records
 */

export const CONTRACT_ADDRESSES = {
  // ZWToken main contract (ZWERC20 implementation)
  ZWERC20: '0x95E31020C1fc1E58695F811e082BE25a243Dcb73',

  // Underlying token (USDC)
  UnderlyingToken: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',

  // Groth16 verifier
  Verifier: '0x7581A7E697587B2588fDde57e278B244A27DeAB4',

  // PoseidonT3 library
  PoseidonT3: '0x0305de4B19eaae16947d8b7bec64d29A86B22189',
} as const;

/**
 * Contract ABI Definitions
 */
export const CONTRACT_ABIS = {
  // ERC20 basic functions
  ERC20: [
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function allowance(address owner, address spender) external view returns (uint256)',
    'function balanceOf(address account) external view returns (uint256)',
    'function transfer(address to, uint256 amount) external returns (bool)',
    'function decimals() external view returns (uint8)',
  ],

  // ZWToken contract (ZWERC20 implementation, IERC8065 standard)
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
 * Token Information
 */
export const TOKEN_INFO = {
  name: 'Zero Knowledge Wrapper USDC',
  symbol: 'ZWUSDC',
  underlyingName: 'USDC',
  underlyingSymbol: 'USDC',
} as const;
