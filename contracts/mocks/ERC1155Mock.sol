// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

/**
 * @title ERC1155Mock
 * @notice Mock ERC1155 token for testing ZWERC1155
 * @dev Implements basic ERC1155 with minting capability
 */
contract ERC1155Mock is ERC1155 {
    constructor(string memory uri_) ERC1155(uri_) {}
    
    /**
     * @notice Mint tokens to the specified address
     * @param to The address that will receive the minted tokens
     * @param id The token ID to mint
     * @param amount The amount of tokens to mint
     * @param data Additional data to pass to the receiver
     */
    function mint(address to, uint256 id, uint256 amount, bytes memory data) external {
        _mint(to, id, amount, data);
    }
    
    /**
     * @notice Batch mint tokens to the specified address
     * @param to The address that will receive the minted tokens
     * @param ids Array of token IDs to mint
     * @param amounts Array of amounts to mint for each token ID
     * @param data Additional data to pass to the receiver
     */
    function mintBatch(address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data) external {
        _mintBatch(to, ids, amounts, data);
    }
    
    /**
     * @notice Burn tokens from the specified address
     * @param from The address to burn tokens from
     * @param id The token ID to burn
     * @param amount The amount of tokens to burn
     */
    function burn(address from, uint256 id, uint256 amount) external {
        _burn(from, id, amount);
    }
    
    /**
     * @notice Batch burn tokens from the specified address
     * @param from The address to burn tokens from
     * @param ids Array of token IDs to burn
     * @param amounts Array of amounts to burn for each token ID
     */
    function burnBatch(address from, uint256[] memory ids, uint256[] memory amounts) external {
        _burnBatch(from, ids, amounts);
    }
}

