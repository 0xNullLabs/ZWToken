// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC1155MetadataURI} from "@openzeppelin/contracts/token/ERC1155/extensions/IERC1155MetadataURI.sol";
import {BaseZWToken} from "./base/BaseZWToken.sol";
import {IERC8065} from "./interfaces/IERC8065.sol";

/**
 * @title ZWERC1155
 * @notice ZK Wrapper Token for ERC-1155 tokens implementing IERC8065
 * @dev Extends BaseZWToken with ERC-1155 specific functionality
 * 
 * Architecture:
 * - Wraps ERC-1155 tokens (both fungible and semi-fungible) into privacy-preserving ZW tokens
 * - Each (address, tokenId) pair has its own first-receipt tracking
 * - Supports multiple token types within a single contract
 * - Uses Poseidon hash (ZK-friendly)
 * - 20-layer Merkle tree (supports 1,048,576 commitments)
 * 
 * Commitment Recording Logic:
 * - deposit(): Records commitment if to != msg.sender
 * - safeTransferFrom(): Records commitment if first receipt for that (address, tokenId)
 * - remint(): Records commitment if first receipt for that (address, tokenId)
 * - withdraw(): NO commitment recorded
 * 
 * Key Differences from ZWERC20:
 * - id parameter = actual tokenId
 * - First receipt tracking is per (address, tokenId) pair
 * - Supports batch operations (but commitment is still per-item)
 */
contract ZWERC1155 is ERC1155, BaseZWToken {
    // ========== Immutable Variables ==========
    
    IERC1155 public immutable underlying;
    
    // ========== State Variables ==========
    
    // Per-tokenId first receipt tracking: tokenId => address => bool
    mapping(uint256 => mapping(address => bool)) public hasTokenFirstReceiptRecorded;
    
    // Token name and symbol (ERC1155 doesn't have these by default)
    string private _name;
    string private _symbol;
    
    // ========== Constructor ==========
    
    /**
     * @notice ZWERC1155 constructor
     * @param name_ Token name
     * @param symbol_ Token symbol
     * @param uri_ Base URI for token metadata
     * @param underlying_ Address of the underlying ERC1155 contract
     * @param config ZWToken configuration (verifier, feeCollector, fees)
     */
    constructor(
        string memory name_,
        string memory symbol_,
        string memory uri_,
        address underlying_,
        ZWConfig memory config
    ) 
        ERC1155(uri_) 
        BaseZWToken(config) 
    {
        require(underlying_ != address(0), "Invalid underlying");
        _name = name_;
        _symbol = symbol_;
        underlying = IERC1155(underlying_);
    }
    
    // ========== Metadata Functions ==========
    
    /**
     * @notice Returns the token name
     */
    function name() public view returns (string memory) {
        return _name;
    }
    
    /**
     * @notice Returns the token symbol
     */
    function symbol() public view returns (string memory) {
        return _symbol;
    }
    
    // ========== Public Functions ==========
    
    /**
     * @notice Deposits ERC1155 tokens and mints ZWERC1155 to the specified address
     * @dev Implements IERC8065.deposit
     * - id is the token identifier
     * - Records commitment if to != msg.sender
     * - Applies depositFee if configured
     * @param to The address that will receive the minted ZWERC1155
     * @param id The token identifier
     * @param amount The amount of tokens to deposit
     * @param data Additional data for extensibility
     */
    function deposit(address to, uint256 id, uint256 amount, bytes calldata data) external payable override {
        if (amount == 0) revert InvalidAmount();
        
        // Transfer underlying tokens from msg.sender
        underlying.safeTransferFrom(msg.sender, address(this), id, amount, "");
        
        // Calculate fee with minimum threshold
        uint256 feeAmount = _calculateFeeWithMin(amount, depositFee, minDepositFee);
        uint256 mintAmount = amount - feeAmount;
        
        // Mint ZWERC1155 to recipient
        _mint(to, id, mintAmount, "");
        
        // Mint fee to fee collector
        if (feeAmount > 0) {
            _mint(feeCollector, id, feeAmount, "");
        }
        
        // Record commitment if to != msg.sender
        if (to != msg.sender) {
            _recordTokenCommitmentIfNeeded(id, to, mintAmount);
        }
        
        emit Deposited(msg.sender, to, id, mintAmount);
        
        // Suppress unused variable warning
        data;
    }
    
    /**
     * @notice Batch deposit ERC1155 tokens
     * @param to The address that will receive the minted tokens
     * @param ids Array of token identifiers
     * @param amounts Array of amounts to deposit
     * @param data Additional data
     */
    function depositBatch(
        address to,
        uint256[] calldata ids,
        uint256[] calldata amounts,
        bytes calldata data
    ) external payable {
        require(ids.length == amounts.length, "Length mismatch");
        
        // Transfer underlying tokens
        underlying.safeBatchTransferFrom(msg.sender, address(this), ids, amounts, "");
        
        uint256[] memory mintAmounts = new uint256[](ids.length);
        uint256[] memory feeAmounts = new uint256[](ids.length);
        bool hasFees = false;
        
        for (uint256 i = 0; i < ids.length; i++) {
            if (amounts[i] == 0) revert InvalidAmount();
            
            feeAmounts[i] = _calculateFeeWithMin(amounts[i], depositFee, minDepositFee);
            mintAmounts[i] = amounts[i] - feeAmounts[i];
            if (feeAmounts[i] > 0) hasFees = true;
        }
        
        // Mint to recipient
        _mintBatch(to, ids, mintAmounts, "");
        
        // Mint fees to collector
        if (hasFees) {
            _mintBatch(feeCollector, ids, feeAmounts, "");
        }
        
        // Record commitments if to != msg.sender
        if (to != msg.sender) {
            for (uint256 i = 0; i < ids.length; i++) {
                _recordTokenCommitmentIfNeeded(ids[i], to, mintAmounts[i]);
            }
        }
        
        // Emit individual events
        for (uint256 i = 0; i < ids.length; i++) {
            emit Deposited(msg.sender, to, ids[i], mintAmounts[i]);
        }
        
        data; // Suppress warning
    }
    
    /**
     * @notice Withdraw underlying tokens by burning ZWERC1155
     * @dev Implements IERC8065.withdraw
     * @param to The recipient address that will receive the underlying tokens
     * @param id The token identifier
     * @param amount The amount to withdraw
     * @param data Additional data for extensibility
     */
    function withdraw(address to, uint256 id, uint256 amount, bytes calldata data) external override {
        if (amount == 0) revert InvalidAmount();
        
        // Burn ZWERC1155 from msg.sender
        _burn(msg.sender, id, amount);
        
        // Calculate fee with minimum threshold
        uint256 feeAmount = _calculateFeeWithMin(amount, withdrawFee, minWithdrawFee);
        uint256 withdrawAmount = amount - feeAmount;
        
        // Mint fee to fee collector
        if (feeAmount > 0) {
            _mint(feeCollector, id, feeAmount, "");
        }
        
        // Transfer underlying tokens to recipient
        underlying.safeTransferFrom(address(this), to, id, withdrawAmount, "");
        
        emit Withdrawn(msg.sender, to, id, amount);
        
        // Suppress unused variable warning
        data;
    }
    
    /**
     * @notice Batch withdraw underlying tokens
     * @param to The recipient address
     * @param ids Array of token identifiers
     * @param amounts Array of amounts to withdraw
     * @param data Additional data
     */
    function withdrawBatch(
        address to,
        uint256[] calldata ids,
        uint256[] calldata amounts,
        bytes calldata data
    ) external {
        require(ids.length == amounts.length, "Length mismatch");
        
        uint256[] memory withdrawAmounts = new uint256[](ids.length);
        uint256[] memory feeAmounts = new uint256[](ids.length);
        bool hasFees = false;
        
        for (uint256 i = 0; i < ids.length; i++) {
            if (amounts[i] == 0) revert InvalidAmount();
            
            feeAmounts[i] = _calculateFeeWithMin(amounts[i], withdrawFee, minWithdrawFee);
            withdrawAmounts[i] = amounts[i] - feeAmounts[i];
            if (feeAmounts[i] > 0) hasFees = true;
        }
        
        // Burn from msg.sender
        _burnBatch(msg.sender, ids, amounts);
        
        // Mint fees to collector
        if (hasFees) {
            _mintBatch(feeCollector, ids, feeAmounts, "");
        }
        
        // Transfer underlying tokens
        underlying.safeBatchTransferFrom(address(this), to, ids, withdrawAmounts, "");
        
        // Emit individual events
        for (uint256 i = 0; i < ids.length; i++) {
            emit Withdrawn(msg.sender, to, ids[i], amounts[i]);
        }
        
        data; // Suppress warning
    }
    
    /**
     * @notice Remint ZWERC1155 using zero-knowledge proof
     * @dev Implements IERC8065.remint
     * @param to Recipient address
     * @param id The token identifier
     * @param amount Amount to remint
     * @param data Encapsulated remint data
     */
    function remint(
        address to,
        uint256 id,
        uint256 amount,
        IERC8065.RemintData calldata data
    ) external override {
        // Parameter validation
        if (amount == 0) revert InvalidAmount();
        require(data.nullifiers.length == 1, "Only single nullifier supported");
        
        // Extract nullifier and validate
        bytes32 nullifier = data.nullifiers[0];
        _validateAndConsumeNullifier(data.commitment, nullifier);
        
        // Parse relayer fee
        uint256 relayerFee = _parseRelayerFee(data.relayerData);
        
        // Verify ZK proof
        _verifyProof(
            data.proof,
            data.commitment,
            nullifier,
            to,
            amount,
            id,
            data.redeem,
            relayerFee
        );
        
        // Execute remint
        _executeRemint(to, id, amount, data.redeem, relayerFee);
    }
    
    /**
     * @dev Execute remint (separated to avoid stack too deep)
     */
    function _executeRemint(
        address to,
        uint256 id,
        uint256 amount,
        bool redeem,
        uint256 relayerFee
    ) private {
        (uint256 protocolFee, uint256 relayerPayment, uint256 recipientAmount) = 
            _calculateRemintFees(amount, redeem, relayerFee);
        
        if (redeem) {
            // Transfer underlying tokens to recipient
            underlying.safeTransferFrom(address(this), to, id, recipientAmount, "");
        } else {
            // Mint ZW tokens to recipient
            _mint(to, id, recipientAmount, "");
            _recordTokenCommitmentIfNeeded(id, to, recipientAmount);
        }
        
        // Pay relayer and protocol fees in the same token
        if (relayerPayment > 0) _mint(msg.sender, id, relayerPayment, "");
        if (protocolFee > 0) _mint(feeCollector, id, protocolFee, "");
        
        emit Reminted(msg.sender, to, id, recipientAmount, redeem);
    }
    
    // ========== Internal Functions ==========
    
    /**
     * @dev Records commitment for first receipt of a specific tokenId
     * @param id Token ID
     * @param to Recipient address
     * @param amount Amount received
     */
    function _recordTokenCommitmentIfNeeded(uint256 id, address to, uint256 amount) internal {
        if (!hasTokenFirstReceiptRecorded[id][to]) {
            hasTokenFirstReceiptRecorded[id][to] = true;
            _insertCommitment(id, to, amount);
        }
    }
    
    /**
     * @dev Override _update to track first receipts for transfers
     */
    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal virtual override {
        super._update(from, to, ids, values);
        
        // Record commitment only for transfers (not mint/burn)
        if (from != address(0) && to != address(0)) {
            for (uint256 i = 0; i < ids.length; i++) {
                _recordTokenCommitmentIfNeeded(ids[i], to, values[i]);
            }
        }
    }
    
    /**
     * @dev Override base _recordCommitmentIfNeeded - for ERC1155 use per-token tracking
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
     * @dev Mint ZWToken implementation (not used for ERC1155, use deposit instead)
     */
    function _mintZWToken(address, uint256) internal pure override {
        revert("Use deposit for ERC1155");
    }
    
    /**
     * @dev Burn ZWToken implementation (not used for ERC1155, use withdraw instead)
     */
    function _burnZWToken(address, uint256) internal pure override {
        revert("Use withdraw for ERC1155");
    }
    
    // ========== IERC8065 Query Functions ==========
    
    /**
     * @notice Returns the total number of commitment leaves
     */
    function getCommitLeafCount(uint256 id) external view override returns (uint256) {
        id; // All tokenIds share the same tree
        return _leaves.length;
    }
    
    /**
     * @notice Returns the current Merkle root
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
     * @notice Preview deposit amount after fees
     */
    function previewDeposit(address to, uint256 id, uint256 amount, bytes calldata data) external view override returns (uint256) {
        uint256 feeAmount = _calculateFeeWithMin(amount, depositFee, minDepositFee);
        to; id; data;
        return amount - feeAmount;
    }
    
    /**
     * @notice Preview withdraw amount after fees
     */
    function previewWithdraw(address to, uint256 id, uint256 amount, bytes calldata data) external view override returns (uint256) {
        uint256 feeAmount = _calculateFeeWithMin(amount, withdrawFee, minWithdrawFee);
        to; id; data;
        return amount - feeAmount;
    }
    
    /**
     * @notice Preview remint amount after fees
     */
    function previewRemint(address to, uint256 id, uint256 amount, IERC8065.RemintData calldata data) external view override returns (uint256) {
        uint256 relayerFee = 0;
        if (data.relayerData.length >= 32) {
            relayerFee = abi.decode(data.relayerData[:32], (uint256));
        }
        
        (,, uint256 recipientAmount) = _calculateRemintFees(amount, data.redeem, relayerFee);
        to; id;
        return recipientAmount;
    }
    
    /**
     * @notice Returns the address of the underlying ERC1155 contract
     */
    function getUnderlying() external view override returns (address) {
        return address(underlying);
    }
    
    /**
     * @notice Returns the token URI from the underlying contract
     */
    function uri(uint256 tokenId) public view virtual override returns (string memory) {
        // Try to get URI from underlying if it implements IERC1155MetadataURI
        try IERC1155MetadataURI(address(underlying)).uri(tokenId) returns (string memory tokenUri) {
            return tokenUri;
        } catch {
            return super.uri(tokenId);
        }
    }
    
    /**
     * @notice Handle ERC1155 token reception (required for safeTransferFrom)
     */
    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes memory
    ) public pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }
    
    /**
     * @notice Handle batch ERC1155 token reception
     */
    function onERC1155BatchReceived(
        address,
        address,
        uint256[] memory,
        uint256[] memory,
        bytes memory
    ) public pure returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }
}

