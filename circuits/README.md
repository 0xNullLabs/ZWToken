# Circuits build guide

Prerequisites

- circom v2.x
- snarkjs v0.7+
- rapidsnark (for fast proving)
- Dependencies in include path: circomlib (poseidon/keccak), circom-rlp, zkTrie/circom-mpt (or equivalent)

Set MAGIC

- 在 `claim_from_state_root.circom` 末尾将 `main` 实例的第三个模板参数替换为你的 MAGIC 数值（十进制或常量）：
  - `component main = ClaimFromStateRoot(8, 8, <MAGIC_DEC>, 1461501637330902918203684832716283019655932542976);`
- TWO160 已固定为 2^160。

Compile

```bash
circom circuits/claim_from_state_root.circom \
  --r1cs --wasm --sym \
  -l <path-to-circomlib> -l <path-to-circom-rlp> -l <path-to-zktrie>
```

Setup (Groth16)

```bash
snarkjs groth16 setup claim_from_state_root.r1cs powersOfTau28_hez_final_19.ptau claim_0000.zkey
snarkjs zkey contribute claim_0000.zkey claim_final.zkey --name "poc"
snarkjs zkey export verificationkey claim_final.zkey verification_key.json
snarkjs zkey export solidityverifier claim_final.zkey contracts/Verifier.sol
```

Prove/Verify (local)

```bash
node claim_from_state_root_js/generate_witness.js \
  claim_from_state_root_js/claim_from_state_root.wasm \
  input.json witness.wtns
snarkjs groth16 prove claim_final.zkey witness.wtns proof.json public.json
snarkjs groth16 verify verification_key.json public.json proof.json
```

Notes

- 需保证公共信号顺序与合约 `ZWToken.claim(...)` 内组装一致：
  `[headerHash, blockNumber, stateRoot, amount, nullifier, chainId, contractAddr, to]`。
- MPT 组件仅需验证：账户（取 storageRoot）与存储（\_balances[addr20]）两条路径。
