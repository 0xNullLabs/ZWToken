# Client claim flow (no address exposure)

前提

- 你拥有 secret（请妥善保管，勿上链、勿日志）。
- MAGIC_ADDRESS 为电路编译期常量，与电路保持一致。
- 使用自建或受信 RPC 节点，避免泄露隐私地址推导结果。

步骤

1. 选块与窗口

   - 读取当前高度 `N0`，选 `B = N0 - 2`。
   - 提交前校验 `current - B <= K`，否则重选。

2. 本地推导隐私地址与 slotKey（仅内存使用，不落盘、不上报）

   - `addrScalar = Poseidon(MAGIC_ADDRESS, secret)`
   - `addr20 = low160(addrScalar)`（取低 160 位，电路中有严谨约束）
   - `slotKey = keccak(pad32(addr20) || pad32(0))`（OZ ERC20 `_balances` 在 slot 0）

3. 拉取证明材料（区块 B）

   - `eth_getProof(tokenContract=this, [slotKey], B)` → `accountProof` + `storageProof[0]`
   - `eth_getBlockByNumber(B, false)` → 区块头字段；离线 RLP 编码得到 `headerRlp`，并计算 `headerHash = keccak(headerRlp)`（同电路内部一致）

4. 构造电路输入

   - 公共输入（链上也会按相同顺序组装）: `[headerHash, B, stateRoot, amount, nullifier, chainId, contractAddr, to]`
   - 私有输入：`secret`、`headerRlp`、账户 MPT 路径、存储 MPT 路径
   - 计算：`nullifier = Poseidon(secret, chainId, contractAddr)`；`amount` 取自存储证明的 balance（256 位，拆分/合成在电路中处理）

5. 生成证明并提交交易
   - 使用 rapidsnark/snarkjs 生成 proof（Groth16）
   - 调用合约：`claim(proof, headerHash, B, stateRoot, amount, nullifier, to)`
   - 若失败（过期/错块/重组），回到第 1 步重选块

数据模板

- circuit public signals（发送到合约）

```json
{
  "headerHash": "0x...",
  "blockNumber": 19000000,
  "stateRoot": "0x...",
  "amount": "123450000000000000000",
  "nullifier": "0x...",
  "chainId": 1,
  "contractAddr": "0xYourToken",
  "to": "0xRecipient"
}
```

- eth_getProof 结果关键字段（简化示例）

```json
{
  "accountProof": ["0xf9...", "0x..."],
  "storageProof": [
    {
      "key": "0x<slotKey>",
      "value": "0x<balance>",
      "proof": ["0xf9...", "0x..."]
    }
  ]
}
```

注意

- 任何时候不要把 `secret`、`addr20`、`slotKey` 传给第三方服务。
- `to` 是公开输入并被证明绑定，提交交易前不可更改，否则验证失败。
- 若要“全项目终身一次”，`nullifier` 的域隔离已通过 `(secret, chainId, contractAddr)` 达成（同一合约维度）。
