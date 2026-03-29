// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockVerifier
 * @notice Mock Groth16 verifier for testing (IERC8065 version with 8 public inputs)
 */
contract MockVerifier {
    bool public result = true;
    
    function setResult(bool _result) external {
        result = _result;
    }
    
    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[8] calldata
    ) external view returns (bool) {
        return result;
    }
}

