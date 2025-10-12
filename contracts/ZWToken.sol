// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";

/**
 * @title ZWToken
 * @notice ZK Wrapper Token with First Receipt Tracking
 * @dev Uses Poseidon hash + 20-layer Merkle tree to maintain privacy commitments
 * 
 * Architecture:
 * - Records first receipt of ZWToken for each address via transfer/transferFrom/claim
 * - Uses Poseidon hash (ZK-friendly, ~25K gas per hash, ~1K circuit constraints)
 * - 20-layer Merkle tree (supports 1,048,576 addresses)
 * - Browser-friendly ZK proof generation (~12K constraints, 5-12 seconds)
 * - No backend dependency (frontend builds Merkle proofs from chain data)
 * 
 * Commitment Recording Logic:
 * - deposit(): Mint (from=0) → NO commitment recorded
 * - transfer/transferFrom(): Transfer (from≠0, to≠0) → Records commitment if first receipt
 * - claim(): Mint to recipient + explicit commitment call → Records if first receipt
 * - withdraw(): Burn (to=0) → NO commitment recorded
 */
contract ZWToken is ERC20 {
    using SafeERC20 for IERC20;

    // ========== Constants ==========
    
    uint256 public constant TREE_DEPTH = 20;
    uint256 public constant MAX_COMMITMENTS = 2**20; // 1,048,576
    uint256 public constant ROOT_HISTORY_SIZE = 100;
    
    // ========== Immutable Variables ==========
    
    IERC20 public immutable underlying;
    ISnarkVerifier public immutable verifier;
    
    // ========== State Variables ==========
    
    // Merkle tree
    bytes32 public root;
    uint256 public nextIndex;
    
    // Merkle tree cache (for efficient incremental updates)
    bytes32[TREE_DEPTH] public zeros;
    bytes32[TREE_DEPTH] public filledSubtrees;
    
    // Root history (all historical roots are valid)
    mapping(bytes32 => bool) public isKnownRoot;
    
    // First receipt tracking
    mapping(address => bool) public hasFirstReceiptRecorded;
    mapping(bytes32 => uint256) public commitmentToIndex;
    
    // Anti-double-claim
    mapping(bytes32 => bool) public nullifierUsed;
    
    // ========== Events ==========
    
    event Deposited(address indexed from, uint256 amount);
    event CommitmentAdded(bytes32 indexed commitment, uint256 index, address indexed recipient, uint256 amount);
    event RootUpdated(bytes32 indexed oldRoot, bytes32 indexed newRoot);
    event Claimed(bytes32 indexed nullifier, address indexed to, uint256 amount);
    
    // ========== Errors ==========
    
    error TreeFull();
    error InvalidRoot();
    error NullifierUsed();
    error InvalidProof();
    error InvalidAmount();
    
    // ========== Constructor ==========
    
    constructor(
        string memory name_,
        string memory symbol_,
        address underlying_,
        address verifier_
    ) ERC20(name_, symbol_) {
        require(underlying_ != address(0), "Invalid underlying");
        require(verifier_ != address(0), "Invalid verifier");
        
        underlying = IERC20(underlying_);
        verifier = ISnarkVerifier(verifier_);
        
        // Initialize Merkle tree with zero hashes
        _initMerkleTree();
    }
    
    // ========== Public Functions ==========
    
    /**
     * @notice Deposit underlying tokens and receive ZWToken
     * @dev Does NOT record commitment - mint (from=0) is excluded in _update
     * @param amount Amount to deposit
     */
    function deposit(uint256 amount) external {
        require(amount > 0, "Amount must > 0");
        
        underlying.safeTransferFrom(msg.sender, address(this), amount);
        
        // Mint ZWToken (from=0, so _update won't record commitment)
        _mint(msg.sender, amount);
        
        emit Deposited(msg.sender, amount);
    }
    
    /**
     * @notice Withdraw underlying tokens by burning ZWToken
     * @param amount Amount to withdraw
     */
    function withdraw(uint256 amount) external {
        require(amount > 0, "Amount must > 0");
        
        _burn(msg.sender, amount);
        underlying.safeTransfer(msg.sender, amount);
    }
    
    /**
     * @notice Claim ZWToken using ZK proof
     * @dev Mints ZWToken to recipient and records commitment if first receipt
     * @param a, b, c Groth16 proof components
     * @param root_ Merkle root (can be historical)
     * @param nullifier Prevents double-claiming
     * @param to Recipient address
     * @param amount Amount to claim
     */
    function claim(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        bytes32 root_,
        bytes32 nullifier,
        address to,
        uint256 amount
    ) external {
        // Verify root is known
        if (!isKnownRoot[root_]) {
            revert InvalidRoot();
        }
        
        // Verify nullifier not used
        if (nullifierUsed[nullifier]) {
            revert NullifierUsed();
        }
        
        // Verify ZK proof
        uint256[4] memory pubInputs = [
            uint256(root_),
            uint256(nullifier),
            uint256(uint160(to)),
            amount
        ];
        
        if (!verifier.verifyProof(a, b, c, pubInputs)) {
            revert InvalidProof();
        }
        
        // Mark nullifier as used
        nullifierUsed[nullifier] = true;
        
        // Mint ZWToken directly to recipient
        _mint(to, amount);
        
        // Manually record commitment if first receipt
        // Note: _mint doesn't trigger commitment (from=0), so we handle it here
        _recordCommitmentIfNeeded(to, amount);
        
        emit Claimed(nullifier, to, amount);
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
        // Mint and burn are handled separately (claim handles mint explicitly)
        if (from != address(0) && to != address(0)) {
            _recordCommitmentIfNeeded(to, amount);
        }
    }
    
    /**
     * @dev Records commitment for first receipt
     * @param to Recipient address
     * @param amount Amount received
     */
    function _recordCommitmentIfNeeded(address to, uint256 amount) private {
        if (!hasFirstReceiptRecorded[to]) {
            hasFirstReceiptRecorded[to] = true;
            
            // Compute commitment = Poseidon(address, firstAmount)
            bytes32 commitment = _poseidonHash(uint256(uint160(to)), amount);
            
            // Insert to Merkle tree
            _insertLeaf(commitment);
            
            emit CommitmentAdded(commitment, nextIndex - 1, to, amount);
        }
    }
    
    /**
     * @dev Initialize Merkle tree with zero hashes
     */
    function _initMerkleTree() private {
        // Compute zero hashes for each level
        bytes32 currentZero = bytes32(0);
        zeros[0] = currentZero;
        
        for (uint256 i = 1; i < TREE_DEPTH; i++) {
            currentZero = _poseidonHash(uint256(currentZero), uint256(currentZero));
            zeros[i] = currentZero;
        }
        
        root = zeros[TREE_DEPTH - 1];
        isKnownRoot[root] = true;
    }
    
    /**
     * @dev Insert a leaf into the Merkle tree
     */
    function _insertLeaf(bytes32 leaf) private {
        uint256 index = nextIndex;
        if (index >= MAX_COMMITMENTS) {
            revert TreeFull();
        }
        
        commitmentToIndex[leaf] = index;
        nextIndex++;
        
        bytes32 currentHash = leaf;
        uint256 currentIndex = index;
        
        for (uint256 i = 0; i < TREE_DEPTH; i++) {
            if (currentIndex % 2 == 0) {
                // Left child
                filledSubtrees[i] = currentHash;
                currentHash = _poseidonHash(uint256(currentHash), uint256(zeros[i]));
            } else {
                // Right child
                currentHash = _poseidonHash(uint256(filledSubtrees[i]), uint256(currentHash));
            }
            
            currentIndex /= 2;
        }
        
        bytes32 oldRoot = root;
        root = currentHash;
        isKnownRoot[root] = true;
        
        emit RootUpdated(oldRoot, root);
    }
    
    /**
     * @dev Compute Poseidon hash of two inputs
     */
    function _poseidonHash(uint256 left, uint256 right) private pure returns (bytes32) {
        uint256[2] memory input = [left, right];
        return bytes32(PoseidonT3.hash(input));
    }
    
    // ========== View Functions ==========
    
    /**
     * @notice Get commitment count
     * @dev Returns nextIndex (no array storage for gas optimization)
     */
    function getCommitmentCount() external view returns (uint256) {
        return nextIndex;
    }
}

// ========== Verifier Interface ==========

interface ISnarkVerifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[4] calldata input
    ) external view returns (bool);
}

