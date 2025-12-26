// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/**
 * @title ERC721Mock
 * @notice Mock ERC721 token for testing ZWERC721
 * @dev Implements basic ERC721 with minting capability
 */
contract ERC721Mock is ERC721 {
    uint256 private _tokenIdCounter;
    
    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_) {}
    
    /**
     * @notice Mint a new token to the specified address
     * @param to The address that will receive the minted token
     * @return tokenId The ID of the newly minted token
     */
    function mint(address to) external returns (uint256) {
        uint256 tokenId = _tokenIdCounter++;
        _mint(to, tokenId);
        return tokenId;
    }
    
    /**
     * @notice Mint a token with a specific ID
     * @param to The address that will receive the minted token
     * @param tokenId The ID of the token to mint
     */
    function mintWithId(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }
    
    /**
     * @notice Burn a token
     * @param tokenId The ID of the token to burn
     */
    function burn(uint256 tokenId) external {
        _burn(tokenId);
    }
    
    /**
     * @notice Get the current token counter
     * @return The current token ID counter value
     */
    function getCurrentTokenId() external view returns (uint256) {
        return _tokenIdCounter;
    }
}

