// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PoseidonMerkleTree} from "./utils/PoseidonMerkleTree.sol";
import {ISnarkVerifier} from "./interfaces/ISnarkVerifier.sol";

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
contract ZWToken is ERC20, PoseidonMerkleTree {
    using SafeERC20 for IERC20;

    // ========== Constants ==========
    
    uint256 private constant _TREE_DEPTH = 20;
    
    // ========== Immutable Variables ==========
    
    IERC20 public immutable underlying;
    ISnarkVerifier public immutable verifier;
    
    // ========== State Variables ==========
    
    // First receipt tracking
    mapping(address => bool) public hasFirstReceiptRecorded;
    mapping(bytes32 => uint256) public commitmentToIndex;
    
    // Anti-double-claim
    mapping(bytes32 => bool) public nullifierUsed;
    
    // ========== Events ==========
    
    event Deposited(address indexed from, uint256 amount);
    event CommitmentAdded(bytes32 indexed commitment, uint256 index, address indexed recipient, uint256 amount);
    event Claimed(bytes32 indexed nullifier, address indexed to, uint256 amount);
    
    // ========== Errors ==========
    
    error InvalidRoot();
    error NullifierUsed();
    error InvalidProof();
    
    // ========== Constructor ==========
    
    constructor(
        string memory name_,
        string memory symbol_,
        address underlying_,
        address verifier_
    ) ERC20(name_, symbol_) PoseidonMerkleTree(_TREE_DEPTH) {
        require(underlying_ != address(0), "Invalid underlying");
        require(verifier_ != address(0), "Invalid verifier");
        
        underlying = IERC20(underlying_);
        verifier = ISnarkVerifier(verifier_);
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
            
            // Store commitment index (before insertion increments nextIndex)
            commitmentToIndex[commitment] = nextIndex;
            
            // Insert to Merkle tree (inherited from PoseidonMerkleTree)
            _insertLeaf(commitment);
            
            emit CommitmentAdded(commitment, nextIndex - 1, to, amount);
        }
    }
    
    // ========== View Functions ==========
    
    /**
     * @notice Get commitment count
     * @dev Returns nextIndex from PoseidonMerkleTree
     */
    function getCommitmentCount() external view returns (uint256) {
        return nextIndex;
    }
}
