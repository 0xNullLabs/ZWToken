// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Metadata} from "@openzeppelin/contracts/token/ERC721/extensions/IERC721Metadata.sol";
import {BaseZWToken} from "./base/BaseZWToken.sol";
import {IERC8065} from "./interfaces/IERC8065.sol";

/**
 * @title ZWERC721
 * @notice ZK Wrapper Token for ERC-721 NFTs implementing IERC8065
 * @dev Extends BaseZWToken with ERC-721 specific functionality
 * 
 * Architecture:
 * - Wraps ERC-721 NFTs into privacy-preserving ZW tokens
 * - Each tokenId has its own first-receipt tracking (per-token commitment)
 * - Amount is always 1 for NFTs
 * - Uses Poseidon hash (ZK-friendly)
 * - 20-layer Merkle tree (supports 1,048,576 commitments)
 * 
 * Commitment Recording Logic:
 * - deposit(): Records commitment if to != msg.sender
 * - transfer/transferFrom(): Records commitment if first receipt for that tokenId
 * - remint(): Records commitment if first receipt for that tokenId
 * - withdraw(): NO commitment recorded
 * 
 * Key Differences from ZWERC20:
 * - id parameter = actual NFT tokenId (not 0)
 * - amount is always 1
 * - First receipt tracking is per (address, tokenId) pair
 */
contract ZWERC721 is ERC721, BaseZWToken {
    // ========== Immutable Variables ==========
    
    IERC721 public immutable underlying;
    
    // ========== State Variables ==========
    
    // Per-tokenId first receipt tracking: tokenId => address => bool
    mapping(uint256 => mapping(address => bool)) public hasTokenFirstReceiptRecorded;
    
    // Track which tokenIds have been minted as ZW tokens
    mapping(uint256 => bool) public tokenExists;
    
    // ========== Constructor ==========
    
    /**
     * @notice ZWERC721 constructor
     * @param name_ Token name
     * @param symbol_ Token symbol
     * @param underlying_ Address of the underlying ERC721 contract
     * @param config ZWToken configuration (verifier, feeCollector, fees)
     */
    constructor(
        string memory name_,
        string memory symbol_,
        address underlying_,
        ZWConfig memory config
    ) 
        ERC721(name_, symbol_) 
        BaseZWToken(config) 
    {
        require(underlying_ != address(0), "Invalid underlying");
        underlying = IERC721(underlying_);
    }
    
    // ========== Public Functions ==========
    
    /**
     * @notice Deposits an NFT and mints a ZWERC721 token to the specified address
     * @dev Implements IERC8065.deposit
     * - id is the NFT tokenId
     * - amount MUST be 1
     * - Records commitment if to != msg.sender
     * @param to The address that will receive the minted ZWERC721
     * @param id The NFT tokenId to deposit
     * @param amount Must be 1 for NFTs
     * @param data Additional data for extensibility (currently unused)
     */
    function deposit(address to, uint256 id, uint256 amount, bytes calldata data) external payable override {
        if (amount != 1) revert InvalidAmount();
        
        // Transfer underlying NFT from msg.sender
        underlying.transferFrom(msg.sender, address(this), id);
        
        // Mint ZWERC721 to recipient
        _mint(to, id);
        tokenExists[id] = true;
        
        // Note: For NFTs, fees are not applicable (amount is always 1, can't deduct fraction)
        // Protocol can charge fees via other mechanisms if needed
        
        // Record commitment if to != msg.sender
        if (to != msg.sender) {
            _recordTokenCommitmentIfNeeded(id, to);
        }
        
        emit Deposited(msg.sender, to, id, 1);
        
        // Suppress unused variable warning
        data;
    }
    
    /**
     * @notice Withdraw NFT by burning ZWERC721
     * @dev Implements IERC8065.withdraw
     * - Burns ZWERC721 from msg.sender
     * - Transfers underlying NFT to the specified recipient
     * @param to The recipient address that will receive the NFT
     * @param id The NFT tokenId to withdraw
     * @param amount Must be 1 for NFTs
     * @param data Additional data for extensibility (currently unused)
     */
    function withdraw(address to, uint256 id, uint256 amount, bytes calldata data) external override {
        if (amount != 1) revert InvalidAmount();
        require(ownerOf(id) == msg.sender, "Not token owner");
        
        // Burn ZWERC721 from msg.sender
        _burn(id);
        tokenExists[id] = false;
        
        // Transfer underlying NFT to recipient
        underlying.transferFrom(address(this), to, id);
        
        emit Withdrawn(msg.sender, to, id, 1);
        
        // Suppress unused variable warning
        data;
    }
    
    /**
     * @notice Remint ZWERC721 using zero-knowledge proof
     * @dev Implements IERC8065.remint
     * Note: For NFTs, fees cannot be deducted from the token itself (amount is always 1).
     *       Relayer fees should be handled off-chain or via separate payment mechanisms.
     * @param to Recipient address that will receive the reminted ZWERC721 or underlying NFT
     * @param id The NFT tokenId
     * @param amount Must be 1 for NFTs
     * @param data Encapsulated remint data
     */
    function remint(
        address to,
        uint256 id,
        uint256 amount,
        IERC8065.RemintData calldata data
    ) external override {
        // Parameter validation
        if (amount != 1) revert InvalidAmount();
        require(data.nullifiers.length == 1, "Only single nullifier supported");
        
        // Extract nullifier and validate
        bytes32 nullifier = data.nullifiers[0];
        _validateAndConsumeNullifier(data.commitment, nullifier);
        
        // Verify ZK proof (relayerFee = 0 for NFTs, fees not applicable)
        _verifyProof(
            data.proof,
            data.commitment,
            nullifier,
            to,
            amount,
            id,
            data.redeem,
            0  // relayerFee is always 0 for NFTs
        );
        
        // Execute remint
        if (data.redeem) {
            // Transfer underlying NFT to recipient
            underlying.transferFrom(address(this), to, id);
        } else {
            // For NFTs: Check if token exists at privacy address
            address currentOwner = _ownerOf(id);
            if (currentOwner != address(0)) {
                // Use internal _update to bypass approval checks (ZK proof is the authorization)
                _update(to, id, address(0));
            } else {
                // Token was burned or doesn't exist - mint new one
                _mint(to, id);
            }
            _recordTokenCommitmentIfNeeded(id, to);
        }
        
        emit Reminted(msg.sender, to, id, 1, data.redeem);
    }
    
    // ========== Internal Functions ==========
    
    /**
     * @dev Records commitment for first receipt of a specific tokenId
     * @param id Token ID
     * @param to Recipient address
     */
    function _recordTokenCommitmentIfNeeded(uint256 id, address to) internal {
        if (!hasTokenFirstReceiptRecorded[id][to]) {
            hasTokenFirstReceiptRecorded[id][to] = true;
            _insertCommitment(id, to, 1); // amount = 1 for NFTs
        }
    }
    
    /**
     * @dev Override _update to track first receipts for transfers
     */
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal virtual override returns (address) {
        address from = super._update(to, tokenId, auth);
        
        // Record commitment only for transfers (not mint/burn)
        if (from != address(0) && to != address(0)) {
            _recordTokenCommitmentIfNeeded(tokenId, to);
        }
        
        return from;
    }
    
    /**
     * @dev Override base _recordCommitmentIfNeeded - for NFTs use per-token tracking
     */
    function _recordCommitmentIfNeeded(uint256 id, address to, uint256 amount) internal override returns (bool) {
        if (!hasTokenFirstReceiptRecorded[id][to]) {
            hasTokenFirstReceiptRecorded[id][to] = true;
            _insertCommitment(id, to, amount);
            return true;
        }
        return false;
    }
    
    /**
     * @dev Mint ZWToken implementation (not used for NFTs, use deposit instead)
     */
    function _mintZWToken(address, uint256) internal pure override {
        revert("Use deposit for NFTs");
    }
    
    /**
     * @dev Burn ZWToken implementation (not used for NFTs, use withdraw instead)
     */
    function _burnZWToken(address, uint256) internal pure override {
        revert("Use withdraw for NFTs");
    }
    
    // ========== IERC8065 Query Functions ==========
    
    /**
     * @notice Returns the total number of commitment leaves
     * @dev For NFTs, this returns total commitments across all tokenIds
     */
    function getCommitLeafCount(uint256 id) external view override returns (uint256) {
        // If id is specified, would need to filter - for simplicity return total
        // In practice, frontend can filter by id from getCommitLeaves
        id; // Suppress warning
        return _leaves.length;
    }
    
    /**
     * @notice Returns the current Merkle root
     * @dev All tokenIds share the same Merkle tree
     */
    function getLatestCommitment(uint256 id) external view override returns (bytes32) {
        id; // All tokenIds share the same tree
        return root;
    }
    
    /**
     * @notice Checks if a specific commitment exists
     */
    function hasCommitment(uint256 id, bytes32 commitment) external view override returns (bool) {
        id; // All tokenIds share the same tree
        return isKnownRoot[commitment];
    }
    
    /**
     * @notice Preview deposit (for NFTs, always returns 1)
     */
    function previewDeposit(address to, uint256 id, uint256 amount, bytes calldata data) external pure override returns (uint256) {
        if (amount != 1) revert InvalidAmount();
        to; id; data;
        return 1;
    }
    
    /**
     * @notice Preview withdraw (for NFTs, always returns 1)
     */
    function previewWithdraw(address to, uint256 id, uint256 amount, bytes calldata data) external pure override returns (uint256) {
        if (amount != 1) revert InvalidAmount();
        to; id; data;
        return 1;
    }
    
    /**
     * @notice Preview remint (for NFTs, always returns 1)
     */
    function previewRemint(address to, uint256 id, uint256 amount, IERC8065.RemintData calldata data) external pure override returns (uint256) {
        if (amount != 1) revert InvalidAmount();
        to; id; data;
        return 1;
    }
    
    /**
     * @notice Returns the address of the underlying NFT contract
     */
    function getUnderlying() external view override returns (address) {
        return address(underlying);
    }
    
    /**
     * @notice Returns the token URI from the underlying NFT
     */
    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        _requireOwned(tokenId);
        
        // Try to get tokenURI from underlying if it implements IERC721Metadata
        try IERC721Metadata(address(underlying)).tokenURI(tokenId) returns (string memory uri) {
            return uri;
        } catch {
            return "";
        }
    }
}

