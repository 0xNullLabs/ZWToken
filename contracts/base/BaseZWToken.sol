// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PoseidonMerkleTree} from "../utils/PoseidonMerkleTree.sol";
import {ISnarkVerifier} from "../interfaces/ISnarkVerifier.sol";
import {IERC8065} from "../interfaces/IERC8065.sol";

/**
 * @title BaseZWToken
 * @notice Abstract base contract for all ZK Wrapper Tokens (ZWERC20, ZWETH, ZWERC721, ZWERC1155)
 * @dev Provides shared functionality:
 *      - Poseidon Merkle Tree for commitment tracking
 *      - Nullifier management (anti-double-spend)
 *      - ZK proof verification
 *      - Fee configuration
 *      - First receipt tracking
 * 
 * Architecture:
 * - Uses Poseidon hash (ZK-friendly, ~25K gas per hash, ~1K circuit constraints)
 * - 20-layer Merkle tree (supports 1,048,576 commitments)
 * - Browser-friendly ZK proof generation (~15K constraints, 5-15 seconds)
 * - Single circuit/verifier for all token types (ERC20, ETH, ERC721, ERC1155)
 * 
 * Commitment Recording Logic:
 * - For ERC20/ETH: commitment = Poseidon(address, amount), id = 0
 * - For ERC721: commitment = Poseidon(address, 1), id = tokenId
 * - For ERC1155: commitment = Poseidon(address, amount), id = tokenId
 */
abstract contract BaseZWToken is PoseidonMerkleTree, IERC8065 {
    // ========== Structs ==========
    
    /**
     * @notice Configuration struct for ZWToken initialization
     * @param verifier Address of the ZK proof verifier contract
     * @param feeCollector Address that receives protocol fees
     * @param feeDenominator Denominator for fee calculations (e.g., 10000 = 100%)
     * @param depositFee Fee rate for deposits in basis points
     * @param remintFee Fee rate for remints in basis points
     * @param withdrawFee Fee rate for withdrawals in basis points
     * @param minDepositFee Minimum absolute fee for deposits (useful for small amounts)
     * @param minWithdrawFee Minimum absolute fee for withdrawals
     * @param minRemintFee Minimum absolute fee for remints
     */
    struct ZWConfig {
        address verifier;
        address feeCollector;
        uint256 feeDenominator;
        uint256 depositFee;
        uint256 remintFee;
        uint256 withdrawFee;
        uint256 minDepositFee;
        uint256 minWithdrawFee;
        uint256 minRemintFee;
    }
    
    // ========== Constants ==========
    
    uint256 internal constant _TREE_DEPTH = 20;
    
    // ========== Immutable Variables ==========
    
    ISnarkVerifier public immutable verifier;
    address public immutable feeCollector;
    
    // Fee configuration (immutable after deployment)
    uint256 public immutable feeDenominator; // e.g., 10000 = 100%, supports 0.01% precision
    uint256 public immutable depositFee;     // basis points
    uint256 public immutable remintFee;      // basis points
    uint256 public immutable withdrawFee;    // basis points
    
    // ========== State Variables ==========
    
    // Minimum fees for small amounts (absolute value, not percentage)
    // Useful when percentage fee rounds to 0 for small amounts (e.g., NFTs, small ERC1155)
    uint256 public minDepositFee;
    uint256 public minWithdrawFee;
    uint256 public minRemintFee;
    
    // First receipt tracking (per address for fungible, per address+tokenId for NFT)
    // For ERC20/ETH: hasFirstReceiptRecorded[address] = true/false
    // For ERC721/ERC1155: Uses tokenId-specific mapping in derived contracts
    mapping(address => bool) public hasFirstReceiptRecorded;
    
    // Commitment to Merkle tree index mapping
    mapping(bytes32 => uint256) public commitmentToIndex;
    
    // Anti-double-spend
    mapping(bytes32 => bool) public nullifierUsed;
    
    // Leaf storage (address + amount for each commitment)
    struct Leaf {
        address to;
        uint256 amount;
        uint256 id; // tokenId for ERC721/ERC1155, 0 for ERC20/ETH
    }
    Leaf[] internal _leaves;
    
    // ========== Errors ==========
    
    error InvalidRoot();
    error NullifierUsed();
    error InvalidProof();
    error InvalidTokenId();
    error InvalidAmount();
    error InvalidFee();
    error TransferFailed();
    
    // ========== Constructor ==========
    
    constructor(ZWConfig memory config) PoseidonMerkleTree(_TREE_DEPTH) {
        require(config.verifier != address(0), "Invalid verifier");
        require(config.feeCollector != address(0), "Invalid fee collector");
        require(config.feeDenominator > 0, "Invalid fee denominator");
        require(config.depositFee < config.feeDenominator, "Invalid deposit fee");
        require(config.remintFee < config.feeDenominator, "Invalid remint fee");
        require(config.withdrawFee < config.feeDenominator, "Invalid withdraw fee");
        
        verifier = ISnarkVerifier(config.verifier);
        feeCollector = config.feeCollector;
        feeDenominator = config.feeDenominator;
        depositFee = config.depositFee;
        remintFee = config.remintFee;
        withdrawFee = config.withdrawFee;
        
        // Initialize minimum fees
        minDepositFee = config.minDepositFee;
        minWithdrawFee = config.minWithdrawFee;
        minRemintFee = config.minRemintFee;
    }
    
    // ========== Internal ZK Functions ==========
    
    /**
     * @dev Verify ZK proof for remint operation
     * @param proof ZK proof bytes
     * @param commitment Merkle root used in proof
     * @param nullifier Anti-double-spend identifier
     * @param to Recipient address
     * @param amount Remint amount
     * @param id Token ID (0 for ERC20/ETH)
     * @param redeem Whether to redeem underlying instead of minting ZWToken
     * @param relayerFee Relayer fee in basis points
     */
    function _verifyProof(
        bytes calldata proof,
        bytes32 commitment,
        bytes32 nullifier,
        address to,
        uint256 amount,
        uint256 id,
        bool redeem,
        uint256 relayerFee
    ) internal view {
        uint256[7] memory pubInputs = [
            uint256(commitment),      // Poseidon output, always < BN128_PRIME
            uint256(nullifier),       // Poseidon output, always < BN128_PRIME
            uint256(uint160(to)),
            amount,
            id,
            redeem ? 1 : 0,
            relayerFee                // Small value, always within BN128 range
        ];
        
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = 
            abi.decode(proof, (uint256[2], uint256[2][2], uint256[2]));
        
        if (!verifier.verifyProof(a, b, c, pubInputs)) {
            revert InvalidProof();
        }
    }
    
    /**
     * @dev Validate and consume nullifier
     * @param commitment Merkle root to validate
     * @param nullifier Nullifier to consume
     */
    function _validateAndConsumeNullifier(
        bytes32 commitment,
        bytes32 nullifier
    ) internal {
        if (!isKnownRoot[commitment]) revert InvalidRoot();
        if (nullifierUsed[nullifier]) revert NullifierUsed();
        nullifierUsed[nullifier] = true;
    }
    
    /**
     * @dev Parse relayer fee from relayer data
     * @param relayerData Relayer data bytes (first 32 bytes = fee)
     * @return relayerFee Relayer fee in basis points
     */
    function _parseRelayerFee(bytes calldata relayerData) internal view returns (uint256 relayerFee) {
        if (relayerData.length >= 32) {
            assembly {
                relayerFee := calldataload(relayerData.offset)
            }
            if (relayerFee >= feeDenominator) revert InvalidFee();
        }
    }
    
    /**
     * @dev Calculate fees for remint operation
     * @param amount Base amount
     * @param redeem Whether redeeming underlying
     * @param relayerFee Relayer fee in basis points
     * @return protocolFee Protocol fee amount
     * @return relayerPayment Relayer payment amount
     * @return recipientAmount Amount for recipient
     */
    function _calculateRemintFees(
        uint256 amount,
        bool redeem,
        uint256 relayerFee
    ) internal view returns (uint256 protocolFee, uint256 relayerPayment, uint256 recipientAmount) {
        uint256 protocolFeeRate = redeem ? remintFee + withdrawFee : remintFee;
        protocolFee = (amount * protocolFeeRate) / feeDenominator;
        relayerPayment = (amount * relayerFee) / feeDenominator;
        recipientAmount = amount - protocolFee - relayerPayment;
    }
    
    /**
     * @dev Calculate fee with minimum threshold
     * @param amount The amount to calculate fee from
     * @param feeRate Percentage fee rate (out of feeDenominator)
     * @param minFee Minimum absolute fee
     * @return The larger of percentage fee or minimum fee (capped at amount - 1)
     */
    function _calculateFeeWithMin(
        uint256 amount,
        uint256 feeRate,
        uint256 minFee
    ) internal view returns (uint256) {
        uint256 percentageFee = feeRate > 0 ? (amount * feeRate) / feeDenominator : 0;
        uint256 fee = percentageFee > minFee ? percentageFee : minFee;
        
        // Cap fee to ensure recipient gets at least 1 token
        if (fee >= amount) {
            fee = amount > 1 ? amount - 1 : 0;
        }
        return fee;
    }
    
    // ========== Admin Functions ==========
    
    /**
     * @notice Set minimum fees for small amounts
     * @dev Only fee collector can set these values
     * @param _minDepositFee Minimum deposit fee (absolute amount)
     * @param _minWithdrawFee Minimum withdraw fee (absolute amount)
     * @param _minRemintFee Minimum remint fee (absolute amount)
     */
    function setMinFees(
        uint256 _minDepositFee,
        uint256 _minWithdrawFee,
        uint256 _minRemintFee
    ) external {
        require(msg.sender == feeCollector, "Only fee collector");
        minDepositFee = _minDepositFee;
        minWithdrawFee = _minWithdrawFee;
        minRemintFee = _minRemintFee;
    }
    
    // ========== Internal Commitment Functions ==========
    
    /**
     * @dev Records commitment for first receipt (fungible tokens - ERC20/ETH)
     * @param id Token ID (0 for ERC20/ETH)
     * @param to Recipient address
     * @param amount Amount received
     * @return recorded Whether a new commitment was recorded
     */
    function _recordCommitmentIfNeeded(uint256 id, address to, uint256 amount) internal virtual returns (bool recorded) {
        if (!hasFirstReceiptRecorded[to]) {
            hasFirstReceiptRecorded[to] = true;
            _insertCommitment(id, to, amount);
            return true;
        }
        return false;
    }
    
    /**
     * @dev Insert commitment into Merkle tree
     * @param id Token ID
     * @param to Recipient address
     * @param amount Amount
     */
    function _insertCommitment(uint256 id, address to, uint256 amount) internal {
        // Compute commitment = Poseidon(address, amount)
        bytes32 commitment = _poseidonHash(uint256(uint160(to)), amount);
        
        // Store commitment index (before insertion increments nextIndex)
        commitmentToIndex[commitment] = nextIndex;
        
        // Insert to Merkle tree
        _insertLeaf(commitment);
        
        // Store leaf
        _leaves.push(Leaf(to, amount, id));
        
        // Emit event
        emit CommitmentUpdated(id, commitment, to, amount);
    }
    
    // ========== IERC8065 Query Functions ==========
    
    /**
     * @notice Returns the total number of commitment leaves stored
     * @dev Implements IERC8065.getCommitLeafCount
     * @param id The token identifier (MUST be 0 for ERC-20/ETH)
     * @return The total count of commitment leaves
     */
    function getCommitLeafCount(uint256 id) external view virtual override returns (uint256) {
        // For fungible tokens, id must be 0
        // Override in ERC721/ERC1155 for per-tokenId counting
        if (id != 0) revert InvalidTokenId();
        return _leaves.length;
    }
    
    /**
     * @notice Returns the current top-level commitment (Merkle root)
     * @dev Implements IERC8065.getLatestCommitment
     * @param id The token identifier (MUST be 0 for ERC-20/ETH)
     * @return The latest root hash of the commitment tree
     */
    function getLatestCommitment(uint256 id) external view virtual override returns (bytes32) {
        if (id != 0) revert InvalidTokenId();
        return root;
    }
    
    /**
     * @notice Checks if a specific commitment (root) exists
     * @dev Implements IERC8065.hasCommitment
     * @param id The token identifier (MUST be 0 for ERC-20/ETH)
     * @param commitment The root hash to verify
     * @return True if the commitment exists, false otherwise
     */
    function hasCommitment(uint256 id, bytes32 commitment) external view virtual override returns (bool) {
        if (id != 0) revert InvalidTokenId();
        return isKnownRoot[commitment];
    }
    
    /**
     * @notice Retrieves leaf-level commit data
     * @dev Implements IERC8065.getCommitLeaves
     * @param id The token identifier
     * @param startIndex Index of the first leaf to fetch
     * @param length Number of leaves to fetch
     * @return commitHashes Hashes of the leaf data
     * @return recipients Recipient addresses of each leaf
     * @return amounts Token amounts of each leaf
     */
    function getCommitLeaves(uint256 id, uint256 startIndex, uint256 length)
        external view virtual override returns (bytes32[] memory commitHashes, address[] memory recipients, uint256[] memory amounts)
    {
        require(startIndex + length <= _leaves.length, "Range out of bounds");
        
        commitHashes = new bytes32[](length);
        recipients = new address[](length);
        amounts = new uint256[](length);
        
        for (uint256 i = 0; i < length; i++) {
            Leaf memory leaf = _leaves[startIndex + i];
            // Filter by id if not 0 (for ERC721/ERC1155)
            if (id != 0 && leaf.id != id) continue;
            recipients[i] = leaf.to;
            amounts[i] = leaf.amount;
            commitHashes[i] = _poseidonHash(uint256(uint160(leaf.to)), leaf.amount);
        }
        
        return (commitHashes, recipients, amounts);
    }
    
    /**
     * @notice Returns the configured fees
     * @dev Not part of IERC8065 but useful for frontend integration
     * @return depositFee_ Fee rate applied to deposits
     * @return remintFee_ Fee rate applied to remints
     * @return withdrawFee_ Fee rate applied to withdrawals
     * @return feeDenominator_ Denominator used to calculate percentage-based fees
     */
    function getFeeConfig() external view returns (
        uint256 depositFee_,
        uint256 remintFee_,
        uint256 withdrawFee_,
        uint256 feeDenominator_
    ) {
        return (depositFee, remintFee, withdrawFee, feeDenominator);
    }
    
    /**
     * @notice Returns the configured minimum fees
     * @dev Not part of IERC8065 but useful for frontend integration
     * @return minDepositFee_ Minimum deposit fee
     * @return minWithdrawFee_ Minimum withdraw fee
     * @return minRemintFee_ Minimum remint fee
     */
    function getMinFeeConfig() external view returns (
        uint256 minDepositFee_,
        uint256 minWithdrawFee_,
        uint256 minRemintFee_
    ) {
        return (minDepositFee, minWithdrawFee, minRemintFee);
    }
    
    // ========== Abstract Functions (to be implemented by derived contracts) ==========
    
    /**
     * @notice Returns the address of the underlying token
     * @dev Must be implemented by derived contracts
     * @return The underlying token contract address (address(0) for ETH)
     */
    function getUnderlying() external view virtual override returns (address);
    
    /**
     * @dev Mint ZWToken to recipient (token-specific implementation)
     */
    function _mintZWToken(address to, uint256 amount) internal virtual;
    
    /**
     * @dev Burn ZWToken from account (token-specific implementation)
     */
    function _burnZWToken(address from, uint256 amount) internal virtual;
}

