// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PoseidonMerkleTree} from "./utils/PoseidonMerkleTree.sol";
import {ISnarkVerifier} from "./interfaces/ISnarkVerifier.sol";
import {IERC8065} from "./interfaces/IERC8065.sol";

/**
 * @title ZWERC20
 * @notice ZK Wrapper Token implementing IERC8065
 * @dev Uses Poseidon hash + 20-layer Merkle tree to maintain privacy commitments
 * 
 * Architecture:
 * - Records first receipt of ZWERC20 for each address via transfer/transferFrom/remint
 * - Uses Poseidon hash (ZK-friendly, ~25K gas per hash, ~1K circuit constraints)
 * - 20-layer Merkle tree (supports 1,048,576 addresses)
 * - Browser-friendly ZK proof generation (~15K constraints, 5-15 seconds)
 * - No backend dependency (frontend builds Merkle proofs from chain data)
 * 
 * Commitment Recording Logic:
 * - depositTo(): Mint (from=0) → Records commitment if to != msg.sender
 * - transfer/transferFrom(): Transfer (from≠0, to≠0) → Records commitment if first receipt
 * - remint(): Mint to recipient + explicit commitment call → Records if first receipt
 * - withdraw(): Burn (to=0) → NO commitment recorded
 */
contract ZWERC20 is ERC20, PoseidonMerkleTree, IERC8065 {
    using SafeERC20 for IERC20;

    // ========== Constants ==========
    
    uint256 private constant _TREE_DEPTH = 20;
    
    // ========== Immutable Variables ==========
    
    uint8 private immutable _decimals;
    IERC20 public immutable underlying;
    ISnarkVerifier public immutable verifier;
    address public immutable feeCollector;
    
    // Fee configuration (immutable after deployment)
    uint256 public immutable feeDenominator; // e.g., 10000 = 100%, supports 0.01% precision
    uint256 public immutable depositFee;     // basis points
    uint256 public immutable remintFee;      // basis points
    uint256 public immutable withdrawFee;    // basis points
    
    // First receipt tracking
    mapping(address => bool) public hasFirstReceiptRecorded;
    mapping(bytes32 => uint256) public commitmentToIndex;
    
    // Anti-double-spend
    mapping(bytes32 => bool) public nullifierUsed;
    
    // Array to store leafs with <to, amount> format
    struct Leaf {
        address to;
        uint256 amount;
    }
    Leaf[] public leafs;
    
    // ========== Events ==========
    // Note: Core IERC8065 events are defined in the interface
    
    // ========== Errors ==========
    
    error InvalidRoot();
    error NullifierUsed();
    error InvalidProof();
    error InvalidTokenId();
    error InvalidAmount();
    error InvalidFee();
    
    // ========== Constructor ==========
    
    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        address underlying_,
        address verifier_,
        address feeCollector_,
        uint256 feeDenominator_,
        uint256 depositFee_,
        uint256 remintFee_,
        uint256 withdrawFee_
    ) ERC20(name_, symbol_) PoseidonMerkleTree(_TREE_DEPTH) {
        require(underlying_ != address(0), "Invalid underlying");
        require(verifier_ != address(0), "Invalid verifier");
        require(feeCollector_ != address(0), "Invalid fee collector");
        require(feeDenominator_ > 0, "Invalid fee denominator");
        require(depositFee_ < feeDenominator_, "Invalid deposit fee");
        require(remintFee_ < feeDenominator_, "Invalid remint fee");
        require(withdrawFee_ < feeDenominator_, "Invalid withdraw fee");
        
        _decimals = decimals_;
        underlying = IERC20(underlying_);
        verifier = ISnarkVerifier(verifier_);
        feeCollector = feeCollector_;
        feeDenominator = feeDenominator_;
        depositFee = depositFee_;
        remintFee = remintFee_;
        withdrawFee = withdrawFee_;
    }
    
    // ========== Public Functions ==========
    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /**
     * @notice Deposits underlying tokens and mints ZWERC20 to the specified address
     * @dev Implements IERC8065.depositTo
     * - For ERC-20: id MUST be 0
     * - Records commitment if to != msg.sender (potential provable burn address)
     * - Applies depositFee if configured
     * @param to The address that will receive the minted ZWERC20
     * @param id The token identifier (MUST be 0 for ERC-20)
     * @param amount The amount of the underlying asset to deposit
     */
    function depositTo(address to, uint256 id, uint256 amount) external payable override {
        if (id != 0) revert InvalidTokenId();
        if (amount == 0) revert InvalidAmount();
        
        // Transfer underlying tokens from msg.sender
        underlying.safeTransferFrom(msg.sender, address(this), amount);
        
        // Calculate mint amount after fee
        uint256 mintAmount = amount;
        uint256 feeAmount = 0;
        if (depositFee > 0) {
            feeAmount = (amount * depositFee) / feeDenominator;
            mintAmount = amount - feeAmount;
        }
        
        // Mint ZWERC20 to recipient
        _mint(to, mintAmount);
        
        // Mint fee to fee collector
        if (feeAmount > 0) {
            _mint(feeCollector, feeAmount);
        }
        
        // Record commitment if to != msg.sender (optimized as per spec)
        // If to == msg.sender, skip commitment (msg.sender cannot be provable burn address)
        if (to != msg.sender) {
            _recordCommitmentIfNeeded(id, to, mintAmount);
        }
        
        emit Deposited(msg.sender, to, id, mintAmount);
    }
    
    /**
     * @notice Withdraw underlying tokens by burning ZWERC20
     * @dev Implements IERC8065.withdraw
     * - Burns ZWERC20 from msg.sender
     * - Transfers underlying tokens to the specified recipient
     * - Applies withdrawFee if configured
     * @param to The recipient address that will receive the underlying token
     * @param id The token identifier (MUST be 0 for ERC-20)
     * @param amount The amount of ZWERC20 to burn
     */
    function withdraw(address to, uint256 id, uint256 amount) external override {
        if (id != 0) revert InvalidTokenId();
        if (amount == 0) revert InvalidAmount();
        
        // Burn ZWERC20 from msg.sender
        _burn(msg.sender, amount);
        
        // Calculate withdraw amount after fee
        uint256 withdrawAmount = amount;
        uint256 feeAmount = 0;
        if (withdrawFee > 0) {
            feeAmount = (amount * withdrawFee) / feeDenominator;
            withdrawAmount = amount - feeAmount;
        }
        
        // Transfer underlying tokens to recipient
        underlying.safeTransfer(to, withdrawAmount);
        
        // Mint fee to fee collector (underlying remains in contract)
        if (feeAmount > 0) {
            _mint(feeCollector, feeAmount);
        }
        
        emit Withdrawn(msg.sender, to, id, amount);
    }
    
    /**
     * @notice Remint ZWERC20 using zero-knowledge proof
     * @dev Implements IERC8065.remint
     * - Verifies ZK proof of provable burn address ownership
     * - Supports direct withdrawal of underlying token (withdrawUnderlying=true)
     * - Supports relayer fee payment
     * - Applies remintFee (and withdrawFee if withdrawing)
     * @param proof Zero-knowledge proof bytes (Groth16 format: a, b, c concatenated)
     * @param commitment The commitment (merkle root) corresponding to the proof
     * @param nullifier Unique nullifier to prevent double-remint
     * @param to Recipient address
     * @param id Token identifier (MUST be 0 for ERC-20)
     * @param amount Amount to remint
     * @param withdrawUnderlying If true, withdraw underlying token instead of minting ZWERC20
     * @param relayerFee Fee rate paid to relayer (in basis points)
     */
    function remint(
        bytes calldata proof,
        bytes32 commitment,
        bytes32 nullifier,
        address to,
        uint256 id,
        uint256 amount,
        bool withdrawUnderlying,
        uint256 relayerFee
    ) external override {
        if (id != 0) revert InvalidTokenId();
        if (amount == 0) revert InvalidAmount();
        if (relayerFee >= feeDenominator) revert InvalidFee();
        
        // Verify commitment is known
        if (!isKnownRoot[commitment]) {
            revert InvalidRoot();
        }
        
        // Verify nullifier not used
        if (nullifierUsed[nullifier]) {
            revert NullifierUsed();
        }
        
        // Decode proof (assuming Groth16 format: 2 + 4 + 2 = 8 uint256s)
        require(proof.length == 256, "Invalid proof length"); // 8 * 32 bytes
        
        // Decode proof from bytes
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = 
            abi.decode(proof, (uint256[2], uint256[2][2], uint256[2]));
        
        // Verify ZK proof
        // Public inputs: [root, nullifier, to, amount, id, withdrawUnderlying, relayerFee]
        uint256[7] memory pubInputs = [
            uint256(commitment),
            uint256(nullifier),
            uint256(uint160(to)),
            amount,
            id,
            withdrawUnderlying ? 1 : 0,
            relayerFee
        ];
        
        if (!_verifyProof(a, b, c, pubInputs)) {
            revert InvalidProof();
        }
        
        // Mark nullifier as used
        nullifierUsed[nullifier] = true;
        
        // Calculate amount after fees
        uint256 protocolFeeRate = remintFee;
        if (withdrawUnderlying) {
            protocolFeeRate += withdrawFee;
        }
        
        uint256 protocolFee = (amount * protocolFeeRate) / feeDenominator;
        uint256 relayerPayment = (amount * relayerFee) / feeDenominator;
        uint256 totalFee = protocolFee + relayerPayment;
        uint256 recipientAmount = amount - totalFee;
        
        if (withdrawUnderlying) {
            // Withdraw underlying token to recipient
            underlying.safeTransfer(to, recipientAmount);
            
            // Pay relayer in zkToken if relayerFee > 0
            if (relayerPayment > 0) {
                _mint(msg.sender, relayerPayment);
            }
            
            // Mint protocol fee to fee collector
            if (protocolFee > 0) {
                _mint(feeCollector, protocolFee);
            }
        } else {
            // Mint ZWERC20 to recipient
            _mint(to, recipientAmount);
            
            // Record commitment if first receipt
            _recordCommitmentIfNeeded(id, to, recipientAmount);
            
            // Pay relayer in ZWERC20 if relayerFee > 0
            if (relayerPayment > 0) {
                _mint(msg.sender, relayerPayment);
            }
            
            // Mint protocol fee to fee collector
            if (protocolFee > 0) {
                _mint(feeCollector, protocolFee);
            }
        }
        
        emit Reminted(msg.sender, to, id, recipientAmount, withdrawUnderlying);
    }
    
    /**
     * @notice Internal proof verification
     * @dev Uses new format (7 inputs) with IERC8065-compiled circuit
     */
    function _verifyProof(
        uint256[2] memory a,
        uint256[2][2] memory b,
        uint256[2] memory c,
        uint256[7] memory pubInputs
    ) internal view returns (bool) {
        // Use new format (7 public inputs) matching the recompiled circuit
        return verifier.verifyProof(a, b, c, pubInputs);
    }
    
    // ========== Internal Functions ==========
    
    /**
     * @dev Override _update to track first receipts for transfers
     * Only records commitment for actual transfers (from != 0, to != 0)
     * Excludes mint (from == 0) and burn (to == 0)
     */
    function _update(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        // Standard ERC20 transfer
        super._update(from, to, amount);
        
        // Record commitment only for transfers (not mint/burn)
        // Mint and burn are handled separately (remint handles mint explicitly)
        if (from != address(0) && to != address(0)) {
            _recordCommitmentIfNeeded(0, to, amount); // id = 0 for ERC-20
        }
    }
    
    /**
     * @dev Records commitment for first receipt
     * @param id Token ID (for event emission only)
     * @param to Recipient address
     * @param amount Amount received
     */
    function _recordCommitmentIfNeeded(uint256 id, address to, uint256 amount) private {
        if (!hasFirstReceiptRecorded[to]) {
            hasFirstReceiptRecorded[to] = true;
            
            // Note: Different token IDs have separate Merkle trees, so there is no need to include the ID in the commitment.
            // Compute commitment = Poseidon(address, amount)
            bytes32 commitment = _poseidonHash(uint256(uint160(to)), amount);
            
            // Store commitment index (before insertion increments nextIndex)
            commitmentToIndex[commitment] = nextIndex;
            
            // Insert to Merkle tree (inherited from PoseidonMerkleTree)
            _insertLeaf(commitment);
            
            // Store leaf in array (id not stored in struct)
            leafs.push(Leaf(to, amount));
            
            // Emit event
            emit CommitmentUpdated(id, commitment, to, amount);
        }
    }
    
    // ========== IERC8065 Query Functions ==========
    
    /**
     * @notice Returns the total number of commitment leaves stored
     * @dev Implements IERC8065.getCommitLeafCount
     * @param id The token identifier (MUST be 0 for ERC-20)
     * @return The total count of commitment leaves
     */
    function getCommitLeafCount(uint256 id) external view override returns (uint256) {
        if (id != 0) revert InvalidTokenId();
        return leafs.length;
    }
    
    /**
     * @notice Returns the current top-level commitment (Merkle root)
     * @dev Implements IERC8065.getLatestCommitment
     * @param id The token identifier (MUST be 0 for ERC-20)
     * @return The latest root hash of the commitment tree
     */
    function getLatestCommitment(uint256 id) external view override returns (bytes32) {
        if (id != 0) revert InvalidTokenId();
        return root;
    }
    
    /**
     * @notice Checks if a specific commitment (root) exists
     * @dev Implements IERC8065.hasCommitment
     * @param id The token identifier (MUST be 0 for ERC-20)
     * @param commitment The root hash to verify
     * @return True if the commitment exists, false otherwise
     */
    function hasCommitment(uint256 id, bytes32 commitment) external view override returns (bool) {
        if (id != 0) revert InvalidTokenId();
        return isKnownRoot[commitment];
    }
    
    /**
     * @notice Retrieves leaf-level commit data
     * @dev Implements IERC8065.getCommitLeaves
     * @param id The token identifier (MUST be 0 for ERC-20)
     * @param startIndex Index of the first leaf to fetch
     * @param length Number of leaves to fetch
     * @return commitHashes Hashes of the leaf data
     * @return recipients Recipient addresses of each leaf
     * @return amounts Token amounts of each leaf
     */
    function getCommitLeaves(uint256 id, uint256 startIndex, uint256 length)
        external view override returns (bytes32[] memory commitHashes, address[] memory recipients, uint256[] memory amounts)
    {
        if (id != 0) revert InvalidTokenId();
        require(startIndex + length <= leafs.length, "Range out of bounds");
        
        commitHashes = new bytes32[](length);
        recipients = new address[](length);
        amounts = new uint256[](length);
        
        for (uint256 i = 0; i < length; i++) {
            Leaf memory leaf = leafs[startIndex + i];
            recipients[i] = leaf.to;
            amounts[i] = leaf.amount;
            commitHashes[i] = _poseidonHash(uint256(uint160(leaf.to)), leaf.amount);
        }
        
        return (commitHashes, recipients, amounts);
    }
    
    /**
     * @notice Returns the configured fees
     * @dev Implements IERC8065.getFeeConfig
     * @return depositFee_ Fee rate applied to deposits
     * @return remintFee_ Fee rate applied to remints
     * @return withdrawFee_ Fee rate applied to withdrawals
     * @return feeDenominator_ Denominator used to calculate percentage-based fees
     */
    function getFeeConfig() external view override returns (
        uint256 depositFee_,
        uint256 remintFee_,
        uint256 withdrawFee_,
        uint256 feeDenominator_
    ) {
        return (depositFee, remintFee, withdrawFee, feeDenominator);
    }
    
    /**
     * @notice Returns the address of the underlying token
     * @dev Implements IERC8065.getUnderlying
     * @return The underlying token contract address
     */
    function getUnderlying() external view override returns (address) {
        return address(underlying);
    }
}

