// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IERC8065
 * @notice Interface for Zero-Knowledge Wrapper Tokens
 * @dev Defines the standard interface for privacy-preserving wrapped tokens
 *      Based on ERC-8065 specification
 */
interface IERC8065 {
    
    // ========== Structs ==========
    
    /**
     * @notice Encapsulates all data required for remint operations
     * @param commitment The commitment (Merkle root) corresponding to the provided proof
     * @param nullifiers Array of unique nullifiers used to prevent double-remint
     * @param proverData Generic data for prover (reserved for future use)
     * @param relayerData Generic data for relayer, can contain fee information. Hash is used in ZK proof.
     * @param redeem If true, withdraws the equivalent underlying token instead of reminting ZWToken
     * @param proof Zero-knowledge proof bytes verifying ownership of the provable burn address
     */
    struct RemintData {
        bytes32 commitment;
        bytes32[] nullifiers;
        bytes proverData;
        bytes relayerData;
        bool redeem;
        bytes proof;
    }
    
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
     * @notice Emitted when underlying tokens are deposited and ZWToken is minted to the recipient
     * @param from The address sending the underlying tokens
     * @param to The address receiving the minted ZWToken (after fees)
     * @param id The token identifier. For fungible tokens that do not have `id`, such as ERC-20, this value MUST be set to `0`.
     * @param amount The net amount of ZWToken minted to `to` after deducting applicable fees
     */
    event Deposited(address indexed from, address indexed to, uint256 indexed id, uint256 amount);
    
    /**
     * @notice Emitted when ZWToken is burned to redeem underlying tokens to the recipient
     * @param from The address burning the ZWToken
     * @param to The address receiving the redeemed underlying tokens (after fees)
     * @param id The token identifier. For fungible tokens that do not have `id`, such as ERC-20, this value MUST be set to `0`.
     * @param amount The net amount of underlying tokens received by `to` after deducting applicable fees
     */
    event Withdrawn(address indexed from, address indexed to, uint256 indexed id, uint256 amount);
    
    /**
     * @notice Emitted upon successful reminting of ZWToken or withdrawal of underlying tokens via a zero-knowledge proof
     * @param from The address initiating the remint operation
     * @param to The address receiving the reminted ZWToken or withdrawn underlying tokens (after fees)
     * @param id The token identifier. For fungible tokens that do not have `id`, such as ERC-20, this value MUST be set to `0`.
     * @param amount The net amount of ZWToken or underlying tokens received by `to` after all applicable fees have been deducted
     * @param redeem If true, withdraws the equivalent underlying tokens instead of reminting ZWToken
     */
    event Reminted(address indexed from, address indexed to, uint256 indexed id, uint256 amount, bool redeem);
    
    // ========== Core Functions ==========
    
    /**
     * @notice Deposits a specified amount of the underlying asset and mints the corresponding amount of ZWToken to the given address.
     * @dev
     * If the underlying asset is an ERC-20/ERC-721/ERC-1155/ERC-6909 token, the caller must approve this contract to transfer the specified `amount` beforehand.
     * If the underlying asset is ETH, the caller should send the deposit value along with the transaction (`msg.value`).
     * @param to The address that will receive the minted ZWTokens.
     * @param id The token identifier. For fungible tokens that do not have `id`, such as ERC-20, this value MUST be set to `0`.
     * @param amount The amount of the underlying asset to deposit.
     * @param data Additional data for extensibility, such as fee information, callback data, or metadata.
     */
    function deposit(address to, uint256 id, uint256 amount, bytes calldata data) external payable;
    
    /**
     * @notice Withdraw underlying tokens by burning ZWToken
     * @param to The recipient address that will receive the underlying token
     * @param id The token identifier. For fungible tokens that do not have `id`, such as ERC-20, this value MUST be set to `0`.
     * @param amount The amount of ZWToken to burn and redeem for the underlying token
     * @param data Additional data for extensibility, such as fee information, callback data, or metadata.
     */
    function withdraw(address to, uint256 id, uint256 amount, bytes calldata data) external;
    
    /**
     * @notice Remint ZWToken using a zero-knowledge proof to unlink the source of funds
     * @dev Interface supports array of nullifiers for future batch remint support.
     *      Current implementations MAY require exactly one nullifier.
     * @param to Recipient address that will receive the reminted ZWToken or the underlying token
     * @param id The token identifier. For fungible tokens that do not have `id`, such as ERC-20, this value MUST be set to `0`.
     * @param amount Amount of ZWToken burned from the provable burn address for reminting
     * @param data Encapsulated remint data including commitment, nullifiers, redeem flag, proof, and relayer information
     */
    function remint(
        address to,
        uint256 id,
        uint256 amount,
        RemintData calldata data
    ) external;
    
    // ========== Optional Preview Functions ==========
    
    /**
     * @notice OPTIONAL: Allows an on-chain or off-chain user to simulate the effects of their deposit at the current block.
     * @dev MUST return as close to and no more than the exact amount of ZWToken that would be minted in a `deposit` call in the same transaction.
     * @param to The address that will receive the minted ZWTokens.
     * @param id The token identifier. For fungible tokens that do not have `id`, such as ERC-20, this value MUST be set to `0`.
     * @param amount The amount of underlying tokens to deposit.
     * @param data Additional data for extensibility, such as fee information.
     * @return The amount of ZWToken that would be minted to the recipient after deducting applicable fees.
     */
    function previewDeposit(address to, uint256 id, uint256 amount, bytes calldata data) external view returns (uint256);
    
    /**
     * @notice OPTIONAL: Allows an on-chain or off-chain user to simulate the effects of their withdrawal at the current block.
     * @dev MUST return as close to and no more than the exact amount of underlying tokens that would be received in a `withdraw` call in the same transaction.
     * @param to The recipient address that will receive the underlying token.
     * @param id The token identifier. For fungible tokens that do not have `id`, such as ERC-20, this value MUST be set to `0`.
     * @param amount The amount of ZWToken to burn.
     * @param data Additional data for extensibility, such as fee information.
     * @return The amount of underlying tokens that would be received by the recipient after deducting applicable fees.
     */
    function previewWithdraw(address to, uint256 id, uint256 amount, bytes calldata data) external view returns (uint256);
    
    /**
     * @notice OPTIONAL: Allows an on-chain or off-chain user to simulate the effects of their remint at the current block.
     * @dev MUST return as close to and no more than the exact amount of ZWToken or underlying tokens that would be received in a `remint` call in the same transaction.
     * @param to Recipient address that will receive the reminted ZWToken or the underlying token.
     * @param id The token identifier. For fungible tokens that do not have `id`, such as ERC-20, this value MUST be set to `0`.
     * @param amount The amount of ZWToken burned from the provable burn address for reminting.
     * @param data Encapsulated remint data including commitment, nullifiers, redeem flag, proof, and relayer information.
     * @return The amount of ZWToken or underlying tokens that would be received by the recipient after all applicable fees have been deducted.
     */
    function previewRemint(address to, uint256 id, uint256 amount, RemintData calldata data) external view returns (uint256);
    
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
     * @notice OPTIONAL: Returns the total number of commitment leaves stored
     * @param id The token identifier. For fungible tokens that do not have `id`, such as ERC-20, this value MUST be set to `0`.
     * @return The total count of commitment leaves
     */
    function getCommitLeafCount(uint256 id) external view returns (uint256);
    
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
     * @notice Returns the address of the underlying token wrapped by this ZWToken
     * @return The underlying token contract address
     */
    function getUnderlying() external view returns (address);
}
