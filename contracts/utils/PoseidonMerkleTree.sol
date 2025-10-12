// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";

/**
 * @title PoseidonMerkleTree
 * @notice Incremental Poseidon Merkle Tree implementation
 * @dev Optimized for gas efficiency with sparse tree representation
 * 
 * Features:
 * - Incremental updates (no need to rebuild entire tree)
 * - Zero-knowledge friendly (uses Poseidon hash)
 * - Gas optimized (stores only filled subtrees)
 * - Supports up to 2^depth leaves
 * 
 * Storage Layout:
 * - zeros[i]: Zero hash at level i
 * - filledSubtrees[i]: Rightmost filled node at level i
 * - root: Current Merkle root
 * - nextIndex: Index of next leaf to insert
 */
abstract contract PoseidonMerkleTree {
    // ========== State Variables ==========
    
    /// @notice Current Merkle root
    bytes32 public root;
    
    /// @notice Index of next leaf to insert
    uint256 public nextIndex;
    
    /// @notice Tree depth (immutable via virtual getter)
    uint256 public immutable TREE_DEPTH;
    
    /// @notice Maximum number of leaves (immutable via virtual getter)
    uint256 public immutable MAX_LEAVES;
    
    /// @notice Zero hashes for each tree level
    bytes32[] internal zeros;
    
    /// @notice Rightmost filled nodes at each level (for incremental updates)
    bytes32[] internal filledSubtrees;
    
    /// @notice Historical roots (for supporting proofs against old states)
    mapping(bytes32 => bool) public isKnownRoot;
    
    // ========== Events ==========
    
    /// @notice Emitted when a new leaf is inserted
    event LeafInserted(uint256 indexed index, bytes32 indexed leaf);
    
    /// @notice Emitted when root is updated
    event RootUpdated(bytes32 indexed oldRoot, bytes32 indexed newRoot);
    
    // ========== Errors ==========
    
    error TreeFull();
    error InvalidDepth();
    
    // ========== Constructor ==========
    
    /**
     * @notice Initialize Merkle tree with specified depth
     * @param depth_ Tree depth (number of levels)
     */
    constructor(uint256 depth_) {
        require(depth_ > 0 && depth_ <= 32, "Invalid depth");
        
        TREE_DEPTH = depth_;
        MAX_LEAVES = 2 ** depth_;
        
        // Initialize zero hashes
        zeros = new bytes32[](depth_);
        filledSubtrees = new bytes32[](depth_);
        
        bytes32 currentZero = bytes32(0);
        zeros[0] = currentZero;
        
        for (uint256 i = 1; i < depth_; i++) {
            currentZero = _poseidonHash(uint256(currentZero), uint256(currentZero));
            zeros[i] = currentZero;
        }
        
        // Initialize root and mark as known
        root = zeros[depth_ - 1];
        isKnownRoot[root] = true;
    }
    
    // ========== Internal Functions ==========
    
    /**
     * @notice Insert a new leaf into the tree
     * @param leaf Leaf value to insert
     */
    function _insertLeaf(bytes32 leaf) internal {
        uint256 index = nextIndex;
        if (index >= MAX_LEAVES) {
            revert TreeFull();
        }
        
        nextIndex++;
        
        // Compute new root using incremental algorithm
        bytes32 currentHash = leaf;
        uint256 currentIndex = index;
        
        for (uint256 i = 0; i < TREE_DEPTH; i++) {
            if (currentIndex % 2 == 0) {
                // Left child - store and hash with zero
                filledSubtrees[i] = currentHash;
                currentHash = _poseidonHash(uint256(currentHash), uint256(zeros[i]));
            } else {
                // Right child - hash with stored left sibling
                currentHash = _poseidonHash(uint256(filledSubtrees[i]), uint256(currentHash));
            }
            
            currentIndex /= 2;
        }
        
        // Update root and mark as known
        bytes32 oldRoot = root;
        root = currentHash;
        isKnownRoot[root] = true;
        
        emit LeafInserted(index, leaf);
        emit RootUpdated(oldRoot, root);
    }
    
    /**
     * @notice Compute Poseidon hash of two inputs
     * @param left Left input
     * @param right Right input
     * @return Hash result as bytes32
     */
    function _poseidonHash(uint256 left, uint256 right) internal pure returns (bytes32) {
        uint256[2] memory input = [left, right];
        return bytes32(PoseidonT3.hash(input));
    }
    
    // ========== View Functions ==========
    
    /**
     * @notice Get zero hash at specific level
     * @param level Tree level (0 = leaves, TREE_DEPTH-1 = root)
     * @return Zero hash at that level
     */
    function getZeroHash(uint256 level) external view returns (bytes32) {
        require(level < TREE_DEPTH, "Invalid level");
        return zeros[level];
    }
    
    /**
     * @notice Get filled subtree at specific level
     * @param level Tree level
     * @return Filled subtree hash at that level
     */
    function getFilledSubtree(uint256 level) external view returns (bytes32) {
        require(level < TREE_DEPTH, "Invalid level");
        return filledSubtrees[level];
    }
    
    /**
     * @notice Get current leaf count
     * @return Number of leaves in the tree
     */
    function getLeafCount() external view returns (uint256) {
        return nextIndex;
    }
    
    /**
     * @notice Check if tree is full
     * @return True if tree is full
     */
    function isFull() external view returns (bool) {
        return nextIndex >= MAX_LEAVES;
    }
}

