// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockVerifier
 * @notice Mock Groth16 verifier for testing
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
        uint256[4] calldata
    ) external view returns (bool) {
        return result;
    }
}

