// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/**
 * @title ERC721Faucet
 * @notice Simple ERC721 faucet for testnet usage
 */
contract ERC721Faucet is ERC721 {
    uint256 private _tokenIdCounter;
    
    constructor(
        string memory name_,
        string memory symbol_
    ) ERC721(name_, symbol_) {
    }
    
    /**
     * @notice Mint a new token from the faucet
     * @param to The address that will receive the minted token
     * @return tokenId The ID of the newly minted token
     */
    function faucetMint(address to) external returns (uint256) {
        uint256 tokenId = _tokenIdCounter++;
        _mint(to, tokenId);
        return tokenId;
    }
    
    /**
     * @notice Returns the current token ID counter value
     * @return The next token ID that will be minted
     */
    function tokenIdCounter() public view returns (uint256) {
        return _tokenIdCounter;
    }
}

