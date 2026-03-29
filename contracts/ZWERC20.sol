// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {BaseZWToken} from "./base/BaseZWToken.sol";
import {IERC8065} from "./interfaces/IERC8065.sol";

/**
 * @title ZWERC20
 * @notice ZK Wrapper Token for ERC-20 tokens implementing IERC8065
 * @dev Extends BaseZWToken with ERC-20 specific functionality
 * 
 * Architecture:
 * - Records first receipt of ZWERC20 for each address via transfer/transferFrom/remint
 * - Uses Poseidon hash (ZK-friendly, ~25K gas per hash, ~1K circuit constraints)
 * - 20-layer Merkle tree (supports 1,048,576 addresses)
 * - Browser-friendly ZK proof generation (~15K constraints, 5-15 seconds)
 * - No backend dependency (frontend builds Merkle proofs from chain data)
 * 
 * Commitment Recording Logic:
 * - deposit(): Mint (from=0) → Records commitment if to != msg.sender
 * - transfer/transferFrom(): Transfer (from≠0, to≠0) → Records commitment if first receipt
 * - remint(): Mint to recipient + explicit commitment call → Records if first receipt
 * - withdraw(): Burn (to=0) → NO commitment recorded
 */
contract ZWERC20 is ERC20, BaseZWToken {
    using SafeERC20 for IERC20;

    // ========== Immutable Variables ==========
    
    uint8 private immutable _decimals;
    IERC20 public immutable underlying;
    
    // ========== Constructor ==========
    
    /**
     * @notice ZWERC20 constructor
     * @param name_ Token name
     * @param symbol_ Token symbol
     * @param decimals_ Token decimals
     * @param underlying_ Address of the underlying ERC20 token
     * @param config ZWToken configuration (verifier, feeCollector, fees)
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        address underlying_,
        ZWConfig memory config
    ) 
        ERC20(name_, symbol_) 
        BaseZWToken(config) 
    {
        require(underlying_ != address(0), "Invalid underlying");
        _decimals = decimals_;
        underlying = IERC20(underlying_);
    }
    
    // ========== Public Functions ==========
    
    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /**
     * @notice Deposits underlying tokens and mints ZWERC20 to the specified address
     * @dev Implements IERC8065.deposit
     * - For ERC-20: id MUST be 0
     * - Records commitment if to != msg.sender (potential provable burn address)
     * - Applies depositFee if configured
     * @param to The address that will receive the minted ZWERC20
     * @param id The token identifier (MUST be 0 for ERC-20)
     * @param amount The amount of the underlying asset to deposit
     * @param data Additional data for extensibility (currently unused)
     */
    function deposit(address to, uint256 id, uint256 amount, bytes calldata data) external payable override {
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
        
        // Suppress unused variable warning
        data;
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
     * @param data Additional data for extensibility (currently unused)
     */
    function withdraw(address to, uint256 id, uint256 amount, bytes calldata data) external override {
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
        
        // Suppress unused variable warning
        data;
    }
    
    /**
     * @notice Remint ZWToken using zero-knowledge proof
     * @dev Implements IERC8065.remint - Current implementation requires exactly one nullifier
     * @param to Recipient address that will receive the reminted ZWToken or underlying token
     * @param id Token identifier (MUST be 0 for ERC-20)
     * @param amount Amount of ZWToken burned from the provable burn address for reminting
     * @param data Encapsulated remint data including commitment, nullifiers, redeem flag, proof, and relayer information
     */
    function remint(
        address to,
        uint256 id,
        uint256 amount,
        IERC8065.RemintData calldata data
    ) external override {
        if (id != 0) revert InvalidTokenId();
        if (amount == 0) revert InvalidAmount();
        require(data.nullifiers.length == 1, "Only single nullifier supported");
        
        bytes32 nullifier = data.nullifiers[0];
        _validateAndConsumeNullifier(data.commitment, nullifier);
        
        uint256 relayerFee = _parseRelayerFee(data.relayerData);
        address revealedAddr = _parseRevealedAddr(data.proverData);
        _requireRevealIfNeeded(amount, revealedAddr);
        
        _verifyProof(
            data.proof,
            data.commitment,
            nullifier,
            to,
            amount,
            id,
            data.redeem,
            relayerFee,
            revealedAddr
        );
        
        // Revealed mode: burn from burn address first to prevent inflation
        if (revealedAddr != address(0)) {
            _burn(revealedAddr, amount);
        }
        
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
            underlying.safeTransfer(to, recipientAmount);
        } else {
            _mint(to, recipientAmount);
            _recordCommitmentIfNeeded(id, to, recipientAmount);
        }
        
        if (relayerPayment > 0) _mint(msg.sender, relayerPayment);
        if (protocolFee > 0) _mint(feeCollector, protocolFee);
        
        emit Reminted(msg.sender, to, id, recipientAmount, redeem);
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
     * @dev Mint ZWToken implementation
     */
    function _mintZWToken(address to, uint256 amount) internal override {
        _mint(to, amount);
    }
    
    /**
     * @dev Burn ZWToken implementation
     */
    function _burnZWToken(address from, uint256 amount) internal override {
        _burn(from, amount);
    }
    
    // ========== IERC8065 Query Functions ==========
    
    /**
     * @notice OPTIONAL: Preview deposit amount after fees
     * @dev Implements IERC8065.previewDeposit
     * @param to The address that will receive the minted ZWTokens (unused in current implementation)
     * @param id The token identifier (MUST be 0 for ERC-20)
     * @param amount The amount of underlying tokens to deposit
     * @param data Additional data (unused in current implementation)
     * @return The amount of ZWToken that would be minted after fees
     */
    function previewDeposit(address to, uint256 id, uint256 amount, bytes calldata data) external view override returns (uint256) {
        if (id != 0) revert InvalidTokenId();
        uint256 feeAmount = depositFee > 0 ? (amount * depositFee) / feeDenominator : 0;
        // Suppress unused variable warnings
        to; data;
        return amount - feeAmount;
    }
    
    /**
     * @notice OPTIONAL: Preview withdraw amount after fees
     * @dev Implements IERC8065.previewWithdraw
     * @param to The recipient address (unused in current implementation)
     * @param id The token identifier (MUST be 0 for ERC-20)
     * @param amount The amount of ZWToken to burn
     * @param data Additional data (unused in current implementation)
     * @return The amount of underlying tokens that would be received after fees
     */
    function previewWithdraw(address to, uint256 id, uint256 amount, bytes calldata data) external view override returns (uint256) {
        if (id != 0) revert InvalidTokenId();
        uint256 feeAmount = withdrawFee > 0 ? (amount * withdrawFee) / feeDenominator : 0;
        // Suppress unused variable warnings
        to; data;
        return amount - feeAmount;
    }
    
    /**
     * @notice OPTIONAL: Preview remint amount after fees
     * @dev Implements IERC8065.previewRemint
     * @param to Recipient address (unused in current implementation)
     * @param id The token identifier (MUST be 0 for ERC-20)
     * @param amount The amount of ZWToken to remint
     * @param data Encapsulated remint data
     * @return The amount of ZWToken or underlying tokens that would be received after fees
     */
    function previewRemint(address to, uint256 id, uint256 amount, IERC8065.RemintData calldata data) external view override returns (uint256) {
        if (id != 0) revert InvalidTokenId();
        
        // Parse relayer fee from relayerData
        uint256 relayerFee = 0;
        if (data.relayerData.length >= 32) {
            relayerFee = abi.decode(data.relayerData[:32], (uint256));
        }
        
        (,, uint256 recipientAmount) = _calculateRemintFees(amount, data.redeem, relayerFee);
        
        // Suppress unused variable warning
        to;
        
        return recipientAmount;
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
