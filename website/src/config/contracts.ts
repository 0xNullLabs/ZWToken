/**
 * Contract Address Configuration
 * From deployment records - Sepolia Testnet
 * Deployed: 2026-03-29
 */

export const CONTRACT_ADDRESSES = {
  // ZWToken main contract (ZWERC20 implementation)
  ZWERC20: '0xa2B0a38aF2c18084630a5372398533F5a3225a29',

  // Underlying token (USDC)
  UnderlyingToken: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',

  // Groth16 verifier (ZWUSDC)
  Verifier: '0xefD3C89c5B296C6f817bab50B225b8789B80aa16',

  // PoseidonT3 library
  PoseidonT3: '0x0305de4B19eaae16947d8b7bec64d29A86B22189',

  // ZWETH main contract
  ZWETH: '0x76baC0887E4c61F3b9E129063F7a24AA25e62BE8',

  // ZWETH Verifier
  ZWETHVerifier: '0xbE7f2C6364FAbBd9E7351360D22735f9E7c980D4',

  // ZWERC721
  ZWERC721: '0x800E52d4Bbe69a372f6Fc27eD59357090DE6fbf8',

  // ZWERC721 Groth16 verifier
  ZWERC721Verifier: '0xB6b781D99001da6DF57D26783860927467f39A98',

  // ZWERC1155
  ZWERC1155: '0x6C89AF2F4038fB68A2F3EF9c26037F1895F46a41',

  // ZWERC1155 Groth16 verifier
  ZWERC1155Verifier: '0x1c6E908f0C8A22dd085761d1D6c9105E6221944d',

  // Underlying ERC721 Mock (also serves as faucet)
  UnderlyingNFT: '0xBF85386b4489b51672e23E9cBf9312A13D3D5093',

  // ERC721 Faucet (same as UnderlyingNFT)
  ERC721Faucet: '0xBF85386b4489b51672e23E9cBf9312A13D3D5093',

  // Underlying ERC1155 Faucet
  UnderlyingERC1155: '0x70989278F35C73A204819E8e73c5f3EBa93f3900',
} as const;

/**
 * Contract ABI Definitions
 * Based on ERC-8065 specification
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
    // Core IERC8065 functions
    'function deposit(address to, uint256 id, uint256 amount, bytes data) external payable',
    'function withdraw(address to, uint256 id, uint256 amount, bytes data) external',
    'function remint(address to, uint256 id, uint256 amount, tuple(bytes32 commitment, bytes32[] nullifiers, bytes proverData, bytes relayerData, bool redeem, bytes proof) data) external',
    // ERC20 functions
    'function transfer(address to, uint256 amount) external returns (bool)',
    'function balanceOf(address account) external view returns (uint256)',
    // Query functions
    'function root() external view returns (bytes32)',
    'function getCommitLeafCount(uint256 id) external view returns (uint256)',
    'function getCommitLeaves(uint256 id, uint256 startIndex, uint256 length) external view returns (bytes32[] memory commitHashes, address[] memory recipients, uint256[] memory amounts)',
    'function getLatestCommitment(uint256 id) external view returns (bytes32)',
    'function hasCommitment(uint256 id, bytes32 commitment) external view returns (bool)',
    'function hasFirstReceiptRecorded(address account) external view returns (bool)',
    'function nullifierUsed(bytes32 nullifier) external view returns (bool)',
    // Preview functions (optional)
    'function previewDeposit(address to, uint256 id, uint256 amount, bytes data) external view returns (uint256)',
    'function previewWithdraw(address to, uint256 id, uint256 amount, bytes data) external view returns (uint256)',
    'function previewRemint(address to, uint256 id, uint256 amount, tuple(bytes32 commitment, bytes32[] nullifiers, bytes proverData, bytes relayerData, bool redeem, bytes proof) data) external view returns (uint256)',
    // Fee config (not in IERC8065, but useful)
    'function getFeeConfig() external view returns (uint256 depositFee, uint256 remintFee, uint256 withdrawFee, uint256 feeDenominator)',
    'function getUnderlying() external view returns (address)',
  ],

  // ZWETH contract (same as ZWERC20 but wraps ETH)
  ZWETH: [
    // Core IERC8065 functions
    'function deposit(address to, uint256 id, uint256 amount, bytes data) external payable',
    'function withdraw(address to, uint256 id, uint256 amount, bytes data) external',
    'function remint(address to, uint256 id, uint256 amount, tuple(bytes32 commitment, bytes32[] nullifiers, bytes proverData, bytes relayerData, bool redeem, bytes proof) data) external',
    // ERC20 functions
    'function transfer(address to, uint256 amount) external returns (bool)',
    'function balanceOf(address account) external view returns (uint256)',
    // Query functions
    'function root() external view returns (bytes32)',
    'function getCommitLeafCount(uint256 id) external view returns (uint256)',
    'function getCommitLeaves(uint256 id, uint256 startIndex, uint256 length) external view returns (bytes32[] memory commitHashes, address[] memory recipients, uint256[] memory amounts)',
    'function getLatestCommitment(uint256 id) external view returns (bytes32)',
    'function hasCommitment(uint256 id, bytes32 commitment) external view returns (bool)',
    'function hasFirstReceiptRecorded(address account) external view returns (bool)',
    'function nullifierUsed(bytes32 nullifier) external view returns (bool)',
    // Preview functions (optional)
    'function previewDeposit(address to, uint256 id, uint256 amount, bytes data) external view returns (uint256)',
    'function previewWithdraw(address to, uint256 id, uint256 amount, bytes data) external view returns (uint256)',
    'function previewRemint(address to, uint256 id, uint256 amount, tuple(bytes32 commitment, bytes32[] nullifiers, bytes proverData, bytes relayerData, bool redeem, bytes proof) data) external view returns (uint256)',
  ],

  // ERC721 basic functions
  ERC721: [
    'function approve(address to, uint256 tokenId) external',
    'function setApprovalForAll(address operator, bool approved) external',
    'function getApproved(uint256 tokenId) external view returns (address)',
    'function isApprovedForAll(address owner, address operator) external view returns (bool)',
    'function ownerOf(uint256 tokenId) external view returns (address)',
    'function balanceOf(address owner) external view returns (uint256)',
    'function tokenURI(uint256 tokenId) external view returns (string memory)',
    'function getCurrentTokenId() external view returns (uint256)',
  ],

  // ERC721 Faucet functions (superset of ERC721, use this for UnderlyingNFT in all cases)
  ERC721Faucet: [
    'function faucetMint(address to) external returns (uint256)',
    'function tokenIdCounter() external view returns (uint256)',
    'function getCurrentTokenId() external view returns (uint256)',
    'function ownerOf(uint256 tokenId) external view returns (address)',
    'function balanceOf(address owner) external view returns (uint256)',
    'function approve(address to, uint256 tokenId) external',
    'function getApproved(uint256 tokenId) external view returns (address)',
  ],

  // ZWERC721 contract (same structure as ZWERC20 but for NFTs)
  ZWERC721: [
    // Core IERC8065 functions
    'function deposit(address to, uint256 id, uint256 amount, bytes data) external payable',
    'function withdraw(address to, uint256 id, uint256 amount, bytes data) external',
    'function remint(address to, uint256 id, uint256 amount, tuple(bytes32 commitment, bytes32[] nullifiers, bytes proverData, bytes relayerData, bool redeem, bytes proof) data) external',
    // ERC721 functions
    'function ownerOf(uint256 tokenId) external view returns (address)',
    'function balanceOf(address account) external view returns (uint256)',
    'function transferFrom(address from, address to, uint256 tokenId) external',
    'function tokenURI(uint256 tokenId) external view returns (string memory)',
    // Query functions
    'function root() external view returns (bytes32)',
    'function getCommitLeafCount(uint256 id) external view returns (uint256)',
    'function getCommitLeaves(uint256 id, uint256 startIndex, uint256 length) external view returns (bytes32[] memory commitHashes, address[] memory recipients, uint256[] memory amounts)',
    'function getLatestCommitment(uint256 id) external view returns (bytes32)',
    'function hasCommitment(uint256 id, bytes32 commitment) external view returns (bool)',
    'function hasTokenFirstReceiptRecorded(uint256 id, address account) external view returns (bool)',
    'function nullifierUsed(bytes32 nullifier) external view returns (bool)',
    // Preview functions
    'function previewDeposit(address to, uint256 id, uint256 amount, bytes data) external view returns (uint256)',
    'function previewWithdraw(address to, uint256 id, uint256 amount, bytes data) external view returns (uint256)',
    'function previewRemint(address to, uint256 id, uint256 amount, tuple(bytes32 commitment, bytes32[] nullifiers, bytes proverData, bytes relayerData, bool redeem, bytes proof) data) external view returns (uint256)',
    'function getUnderlying() external view returns (address)',
  ],
} as const;

/**
 * Token Information
 */
export const TOKEN_INFO = {
  ZWUSDC: {
    name: 'Zero Knowledge Wrapper USDC',
    symbol: 'ZWUSDC',
    underlyingName: 'USDC',
    underlyingSymbol: 'USDC',
  },
  ZWETH: {
    name: 'ZK Wrapper ETH',
    symbol: 'ZWETH',
    underlyingName: 'ETH',
    underlyingSymbol: 'ETH',
  },
  ZWNFT: {
    name: 'ZK Wrapper NFT',
    symbol: 'ZWNFT',
    underlyingName: 'NFT',
    underlyingSymbol: 'NFT',
  },
} as const;
