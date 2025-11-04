// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IERC8065
 * @notice Interface for Zero-Knowledge Wrapper Tokens
 * @dev Defines the standard interface for privacy-preserving wrapped tokens
 */
interface IERC8065 {
    
    // ========== Events ==========
    
    /**
     * @notice OPTIONAL event emitted when a commitment is updated in the contract
     * @param id The token identifier. For fungible tokens that do not have `id`, such as ERC-20, this value MUST be set to `0`.
     * @param commitment The new top-level commitment hash
     * @param to The recipient address associated with the commitment
     * @param amount The amount related to this commitment update
     */
    event CommitmentUpdated(uint256 indexed id, bytes32 indexed commitment, address indexed to, uint256 amount);
    
    /**
     * @notice Emitted when underlying tokens are deposited and ZWToken is minted
     * @param from The address sending the underlying tokens
     * @param to The address receiving the minted ZWToken
     * @param id The token identifier. For fungible tokens that do not have `id`, such as ERC-20, this value MUST be set to `0`.
     * @param amount The amount of tokens deposited/minted
     */
    event Deposited(address indexed from, address indexed to, uint256 indexed id, uint256 amount);
    
    /**
     * @notice Emitted when ZWToken is burned to redeem underlying tokens
     * @param from The address burning the ZWToken
     * @param to The address receiving the underlying tokens
     * @param id The token identifier. For fungible tokens that do not have `id`, such as ERC-20, this value MUST be set to `0`.
     * @param amount The amount of tokens withdrawn/redeemed
     */
    event Withdrawn(address indexed from, address indexed to, uint256 indexed id, uint256 amount);
    
    /**
     * @notice Emitted upon successful reminting of ZWToken via a zero-knowledge proof
     * @param from The address initiating the remint function
     * @param to The address receiving the reminted ZWToken
     * @param id The token identifier. For fungible tokens that do not have `id`, such as ERC-20, this value MUST be set to `0`.
     * @param amount The amount of ZWToken reminted
     * @param withdrawUnderlying If true, withdraws the equivalent underlying token instead of reminting ZWToken
     */
    event Reminted(address indexed from, address indexed to, uint256 indexed id, uint256 amount, bool withdrawUnderlying);
    
    // ========== Core Functions ==========
    
    /**
     * @notice Deposits a specified amount of the underlying asset and mints the corresponding amount of ZWToken to the given address.
     * @dev
     * If the underlying asset is an ERC-20/ERC-721/ERC-1155/ERC-6909 token, the caller must approve this contract to transfer the specified `amount` beforehand.
     * If the underlying asset is ETH, the caller should send the deposit value along with the transaction (`msg.value`).
     * @param to The address that will receive the minted ZWTokens.
     * @param id The token identifier. For fungible tokens that do not have `id`, such as ERC-20, this value MUST be set to `0`.
     * @param amount The amount of the underlying asset to deposit.
     */
    function depositTo(address to, uint256 id, uint256 amount) external payable;
    
    /**
     * @notice Withdraw underlying tokens by burning ZWToken
     * @param to The recipient address that will receive the underlying token
     * @param id The token identifier. For fungible tokens that do not have `id`, such as ERC-20, this value MUST be set to `0`.
     * @param amount The amount of ZWToken to burn and redeem for the underlying token
     */
    function withdraw(address to, uint256 id, uint256 amount) external;
    
    /**
     * @notice Remint ZWToken using a zero-knowledge proof to unlink the source of funds
     * @param proof Zero-knowledge proof bytes verifying ownership of the provable burn address
     * @param commitment The commitment corresponding to the provided proof
     * @param nullifier Unique nullifier used to prevent double-remint
     * @param to Recipient address that will receive the reminted ZWToken or the underlying token
     * @param id The token identifier. For fungible tokens that do not have `id`, such as ERC-20, this value MUST be set to `0`.
     * @param amount Amount of ZWToken burned from the provable burn address for reminting
     * @param withdrawUnderlying If true, withdraws the equivalent underlying token instead of reminting ZWToken
     * @param relayerFee Fee paid to the relayer that submits the remint transaction, if executed through a relayer
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
    ) external;
    
    // ========== Query Functions ==========
    
    /**
     * @notice Returns the current top-level commitment representing the privacy state
     * @param id The token identifier. For fungible tokens that do not have `id`, such as ERC-20, this value MUST be set to `0`.
     * @return The latest root hash of the commitment tree
     */
    function getLatestCommitment(uint256 id) external view returns (bytes32);
    
    /**
     * @notice Checks if a specific top-level commitment exists
     * @param id The token identifier. For fungible tokens that do not have `id`, such as ERC-20, this value MUST be set to `0`.
     * @param commitment The root hash to verify
     * @return True if the commitment exists, false otherwise
     */
    function hasCommitment(uint256 id, bytes32 commitment) external view returns (bool);
    
    /**
     * @notice OPTIONAL: Retrieves leaf-level commit data and their hashes
     * @param id The token identifier. For fungible tokens that do not have `id`, such as ERC-20, this value MUST be set to `0`.
     * @param startIndex Index of the first leaf to fetch
     * @param length Number of leaves to fetch
     * @return commitHashes Hashes of the leaf data
     * @return recipients Recipient addresses of each leaf
     * @return amounts Token amounts of each leaf
     */
    function getCommitLeaves(uint256 id, uint256 startIndex, uint256 length)
        external view returns (bytes32[] memory commitHashes, address[] memory recipients, uint256[] memory amounts);
    
    /**
     * @notice OPTIONAL: Returns the total number of commitment leaves stored
     * @param id The token identifier. For fungible tokens that do not have `id`, such as ERC-20, this value MUST be set to `0`.
     * @return The total count of commitment leaves
     */
    function getCommitLeafCount(uint256 id) external view returns (uint256);
    
    /**
     * @notice Returns the configured fees for deposit, remint, and withdrawal operations
     * @return depositFee Fee rate applied to deposits
     * @return remintFee Fee rate applied to remints
     * @return withdrawFee Fee rate applied to withdrawals
     * @return feeDenominator Denominator used to calculate percentage-based fees
     */
    function getFeeConfig() external view returns (uint256 depositFee, uint256 remintFee, uint256 withdrawFee, uint256 feeDenominator);
    
    /**
     * @notice Returns the address of the underlying token wrapped by this ZWToken
     * @return The underlying token contract address
     */
    function getUnderlying() external view returns (address);
}


