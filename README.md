# ZWToken

目标:

- 地址由 Poseidon(MAGIC_ADDRESS || secret) 推导, 取低 160 位为 addr (仅在电路内使用, 不上链、不输出)。
- 无需地址签名; 仅做余额的链上状态证明(账户+存储 MPT)与区块头绑定。
- 同合约内: ERC20 与 claim; nullifier(secret, chainId, contractAddr) 终身仅一次; 区块哈希在最近 256 块窗口内校验。

目录:

- circuits/claim_from_state_root.circom — 电路骨架(Poseidon→addr、区块头 RLP→headerHash、账户/存储 MPT、nullifier)
- contracts/ZWToken.sol — 单合约 ERC20 + claim + Verifier 集成
- client/claim_flow.md — 证明与领取的端到端步骤与输入/输出说明

参数与域值:

- MAGIC_ADDRESS: 由你指定的常量字节串; 必须与电路一致(编译期常量)。
- K(新鲜度窗口): 建议 8–12; 合约中构造设定。
- nullifier: Poseidon(secret, chainId, contractAddr)
- 公共输入顺序(电路/合约一致):
  [headerHash, blockNumber, stateRoot, amount, nullifier, chainId, contractAddr, to]

推进步骤:

1. 完成电路实现与测试向量(circomlib: poseidon/keccak; circom-rlp; zkTrie/circom-mpt)
2. Groth16 setup 与 zkey 生成; 导出 Verifier.sol
3. 部署 ZWToken 与 Verifier; 设置 K
4. 客户端: 选择目标块(head-2)→eth_getProof(账户+存储)→ 获取区块头 → 本地生成证明 → 调用 claim
5. 测试: 成功领取、重复领取失败、错块/过期、篡改 to 失败、reorg 后重选块

注意:

- 为避免对第三方 RPC 泄露隐私地址, 建议在本地或受信节点上计算 slotKey。
- 余额读取基于标准 OpenZeppelin ERC20: \_balances 映射位于 slotIndex=0。
- to 为公开输入; 空投接收地址与隐私地址解耦。

快速开始:

- 设置 MAGIC: 见 `circuits/README.md`，修改 `main` 实例第三个模板参数。
- 构建电路与 verifier: 见 `circuits/README.md`。
- 生成输入与提交：
  - `npm i` (在 zk-claim-poc 内)
  - `node client/build_inputs.js --rpc <RPC> --token <TOKEN> --secret <0x..> --magic <0x..> --to <RECIPIENT> > inputs.json`
  - 使用 circom/snarkjs 生成 `proof.json`
  - `node client/submit_claim.js --rpc <RPC> --pk <PRIVKEY> --contract <TOKEN> --proof proof.json --inputs inputs.json`

# 快速证明与提交

生成高层输入

```bash
node client/build_inputs.js --rpc $RPC --token $TOKEN --secret $SECRET --magic $MAGIC --to $TO --out inputs.json --public-out public.json
```

转换为电路输入

```bash
node client/build_circuit_input.js --in inputs.json --out circuit_input.json
```

生成证明（示例）

```bash
node circuits/out/claim_from_state_root_js/generate_witness.js \
  circuits/out/claim_from_state_root_js/claim_from_state_root.wasm \
  circuit_input.json witness.wtns
snarkjs groth16 prove circuits/out/claim_final.zkey witness.wtns proof.json public.json
snarkjs groth16 verify circuits/out/verification_key.json public.json proof.json
```

提交领取

```bash
node client/submit_claim.js --rpc $RPC --pk $PK --contract $TOKEN --proof proof.json --inputs inputs.json
```

# 性能与安全提示

- 证明时间：无签名版本主要成本为 RLP/Keccak/MPT，建议 Groth16 + rapidsnark；将 MPT 路径控制在单地址/单槽位。
- 窗口 K：默认 10（≈2 分钟），可按证明时延调整；永远小于 256。
- 隐私：不要将 secret/addr20/slotKey 发送给第三方；使用自建或受信 RPC。
- DoS：合约先查 `usedNullifier` 再验证明；错误输入尽早 revert。
- 重放：`nullifier = Poseidon(secret, chainId, contractAddr)` 绑定合约与链；`to` 为公开输入，复制 proof 改 to 会失败。

# 最终检查清单

- [ ] circuits/claim_from_state_root.circom 设置 MAGIC，并接入 RLP/Keccak/MPT（占位已就绪）
- [x] 合约 ZWToken 支持 snarkjs verifier，并完成 nullifier 去重
- [x] CLI：build_inputs/build_circuit_input/submit_claim
- [x] Hardhat：本地部署脚本与测试（含 MockVerifier）
- [x] 脚本：prepare_ptau/build_circuit
- [ ] 导出真实 Verifier.sol，替换占位版/MockVerifier 并端到端验证
