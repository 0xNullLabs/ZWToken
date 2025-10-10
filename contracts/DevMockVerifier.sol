// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DevMockVerifier {
    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[] calldata
    ) external pure returns (bool) {
        return true;
    }
}
