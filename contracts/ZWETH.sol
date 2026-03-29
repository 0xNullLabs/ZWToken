// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {BaseZWToken} from "./base/BaseZWToken.sol";
import {IERC8065} from "./interfaces/IERC8065.sol";

/**
 * @title ZWETH
 * @notice ZK Wrapper Token for native ETH implementing IERC8065
 * @dev Extends BaseZWToken with ETH-specific functionality
 * 
 * Architecture:
 * - Wraps native ETH into an ERC-20 compatible ZW token
 * - Records first receipt for each address via transfer/transferFrom/remint
 * - Uses Poseidon hash (ZK-friendly, ~25K gas per hash, ~1K circuit constraints)
 * - 20-layer Merkle tree (supports 1,048,576 addresses)
 * - Browser-friendly ZK proof generation (~15K constraints, 5-15 seconds)
 * 
 * Commitment Recording Logic:
 * - deposit(): Mint (from=0) → Records commitment if to != msg.sender
 * - transfer/transferFrom(): Transfer (from≠0, to≠0) → Records commitment if first receipt
 * - remint(): Mint to recipient + explicit commitment call → Records if first receipt
 * - withdraw(): Burn (to=0) → NO commitment recorded
 */
contract ZWETH is ERC20, BaseZWToken {
    // ========== Constructor ==========
    
    /**
     * @notice ZWETH constructor
     * @param name_ Token name
     * @param symbol_ Token symbol
     * @param config ZWToken configuration (verifier, feeCollector, fees)
     */
    constructor(
        string memory name_,
        string memory symbol_,
        ZWConfig memory config
    ) 
        ERC20(name_, symbol_) 
        BaseZWToken(config) 
    {}
    
    // ========== Public Functions ==========
    
    /**
     * @notice Deposits ETH and mints ZWETH to the specified address
     * @dev Implements IERC8065.deposit
     * - For ETH: id MUST be 0
     * - msg.value should equal amount
     * - Records commitment if to != msg.sender (potential provable burn address)
     * - Applies depositFee if configured
     * @param to The address that will receive the minted ZWETH
     * @param id The token identifier (MUST be 0 for ETH)
     * @param amount The amount of ETH to deposit (must match msg.value)
     * @param data Additional data for extensibility (currently unused)
     */
    function deposit(address to, uint256 id, uint256 amount, bytes calldata data) external payable override {
        if (id != 0) revert InvalidTokenId();
        if (amount == 0) revert InvalidAmount();
        require(msg.value == amount, "ETH amount mismatch");
        
        // Calculate mint amount after fee
        uint256 mintAmount = amount;
        uint256 feeAmount = 0;
        if (depositFee > 0) {
            feeAmount = (amount * depositFee) / feeDenominator;
            mintAmount = amount - feeAmount;
        }
        
        // Mint ZWETH to recipient
        _mint(to, mintAmount);
        
        // Mint fee to fee collector
        if (feeAmount > 0) {
            _mint(feeCollector, feeAmount);
        }
        
        // Record commitment if to != msg.sender (optimized as per spec)
        if (to != msg.sender) {
            _recordCommitmentIfNeeded(id, to, mintAmount);
        }
        
        emit Deposited(msg.sender, to, id, mintAmount);
        
        // Suppress unused variable warning
        data;
    }
    
    /**
     * @notice Withdraw ETH by burning ZWETH
     * @dev Implements IERC8065.withdraw
     * - Burns ZWETH from msg.sender
     * - Transfers ETH to the specified recipient
     * - Applies withdrawFee if configured
     * @param to The recipient address that will receive the ETH
     * @param id The token identifier (MUST be 0 for ETH)
     * @param amount The amount of ZWETH to burn
     * @param data Additional data for extensibility (currently unused)
     */
    function withdraw(address to, uint256 id, uint256 amount, bytes calldata data) external override {
        if (id != 0) revert InvalidTokenId();
        if (amount == 0) revert InvalidAmount();
        
        // Burn ZWETH from msg.sender
        _burn(msg.sender, amount);
        
        // Calculate withdraw amount after fee
        uint256 withdrawAmount = amount;
        uint256 feeAmount = 0;
        if (withdrawFee > 0) {
            feeAmount = (amount * withdrawFee) / feeDenominator;
            withdrawAmount = amount - feeAmount;
        }
        
        // Mint fee to fee collector
        if (feeAmount > 0) {
            _mint(feeCollector, feeAmount);
        }
        
        // Transfer ETH to recipient
        (bool success, ) = to.call{value: withdrawAmount}("");
        if (!success) revert TransferFailed();
        
        emit Withdrawn(msg.sender, to, id, amount);
        
        // Suppress unused variable warning
        data;
    }
    
    /**
     * @notice Remint ZWETH using zero-knowledge proof
     * @dev Implements IERC8065.remint - Current implementation requires exactly one nullifier
     * @param to Recipient address that will receive the reminted ZWETH or ETH
     * @param id Token identifier (MUST be 0 for ETH)
     * @param amount Amount of ZWETH burned from the provable burn address for reminting
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
            // Transfer ETH to recipient
            (bool success, ) = to.call{value: recipientAmount}("");
            if (!success) revert TransferFailed();
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
     */
    function _update(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        super._update(from, to, amount);
        
        // Record commitment only for transfers (not mint/burn)
        if (from != address(0) && to != address(0)) {
            _recordCommitmentIfNeeded(0, to, amount);
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
     */
    function previewDeposit(address to, uint256 id, uint256 amount, bytes calldata data) external view override returns (uint256) {
        if (id != 0) revert InvalidTokenId();
        uint256 feeAmount = depositFee > 0 ? (amount * depositFee) / feeDenominator : 0;
        to; data;
        return amount - feeAmount;
    }
    
    /**
     * @notice OPTIONAL: Preview withdraw amount after fees
     */
    function previewWithdraw(address to, uint256 id, uint256 amount, bytes calldata data) external view override returns (uint256) {
        if (id != 0) revert InvalidTokenId();
        uint256 feeAmount = withdrawFee > 0 ? (amount * withdrawFee) / feeDenominator : 0;
        to; data;
        return amount - feeAmount;
    }
    
    /**
     * @notice OPTIONAL: Preview remint amount after fees
     */
    function previewRemint(address to, uint256 id, uint256 amount, IERC8065.RemintData calldata data) external view override returns (uint256) {
        if (id != 0) revert InvalidTokenId();
        
        uint256 relayerFee = 0;
        if (data.relayerData.length >= 32) {
            relayerFee = abi.decode(data.relayerData[:32], (uint256));
        }
        
        (,, uint256 recipientAmount) = _calculateRemintFees(amount, data.redeem, relayerFee);
        to;
        return recipientAmount;
    }
    
    /**
     * @notice Returns address(0) as the underlying is native ETH
     */
    function getUnderlying() external pure override returns (address) {
        return address(0);
    }
    
    /**
     * @notice Receive ETH (for direct transfers)
     */
    receive() external payable {}
}

