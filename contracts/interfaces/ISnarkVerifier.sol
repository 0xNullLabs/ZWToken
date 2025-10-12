// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ISnarkVerifier
 * @notice Interface for Groth16 ZK-SNARK verifier
 * @dev Used to verify zero-knowledge proofs for private claims
 */
interface ISnarkVerifier {
    /**
     * @notice Verify a Groth16 proof
     * @param a Proof component A (G1 point)
     * @param b Proof component B (G2 point)
     * @param c Proof component C (G1 point)
     * @param input Public inputs to the circuit
     * @return True if proof is valid, false otherwise
     */
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[4] calldata input
    ) external view returns (bool);
}

