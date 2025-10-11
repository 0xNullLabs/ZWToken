// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title DevMockVerifier
 * @notice Mock verifier for development/testing
 * @dev 接口与 Groth16Verifier 完全一致，使用固定大小数组 uint[8]
 * 在开发环境中始终返回 true，方便测试
 */
contract DevMockVerifier {
    /**
     * @notice 验证 Groth16 proof（Mock 版本，始终返回 true）
     * @param _pA proof 的 a 部分
     * @param _pB proof 的 b 部分  
     * @param _pC proof 的 c 部分
     * @param _pubSignals 公共输入信号（固定 8 个）
     * @return 始终返回 true
     */
    function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[8] calldata _pubSignals
    ) external pure returns (bool) {
        // 避免编译器警告未使用的参数
        (_pA, _pB, _pC, _pubSignals);
        
        // Mock: 始终返回 true
        return true;
    }
}
