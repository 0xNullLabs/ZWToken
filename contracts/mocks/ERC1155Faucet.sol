// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

/**
 * @title ERC1155Faucet
 * @notice Simple ERC1155 faucet for testnet usage
 */
contract ERC1155Faucet is ERC1155 {
    uint256 private _tokenIdCounter;
    string private _name;
    string private _symbol;
    
    constructor(
        string memory name_,
        string memory symbol_
    ) ERC1155("") {
        _name = name_;
        _symbol = symbol_;
    }

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
    
    /**
     * @notice Returns the current token ID counter value
     * @return The next token ID that will be minted
     */
    function tokenIdCounter() public view returns (uint256) {
        return _tokenIdCounter;
    }
    
    /**
     * @notice Mint tokens from the faucet
     * @param to The address that will receive the minted tokens
     * @param amount The amount of tokens to mint
     * @return tokenId The ID of the newly minted token
     */
    function faucetMint(
        address to,
        uint256 amount
    ) external returns (uint256) {
        uint256 tokenId = _tokenIdCounter++;
        _mint(to, tokenId, amount, "");
        return tokenId;
    }
}

