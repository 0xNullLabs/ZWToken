// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ISnarkVerifier
 * @notice Interface for Groth16 ZK-SNARK verifier (IERC8065 version)
 * @dev Used to verify zero-knowledge proofs for private remint operations
 */
interface ISnarkVerifier {
    /**
     * @notice Verify a Groth16 proof with 7 public inputs (IERC8065)
     * @param a Proof component A (G1 point)
     * @param b Proof component B (G2 point)
     * @param c Proof component C (G1 point)
     * @param input Public inputs: [root, nullifier, to, amount, id, withdrawUnderlying, relayerFee]
     * @return True if proof is valid, false otherwise
     */
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[7] calldata input
    ) external view returns (bool);
}

