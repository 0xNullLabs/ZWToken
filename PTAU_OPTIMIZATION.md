# PTAU 文件优化完成

**日期**: 2025-10-12  
**优化**: ✅ **从 4.5GB 减少到 22MB**

---

## 📊 优化对比

| 指标          | 优化前    | 优化后   | 改进         |
| ------------- | --------- | -------- | ------------ |
| **PTAU 文件** | PTAU 22   | PTAU 15  | -            |
| **文件大小**  | 4.5GB     | **22MB** | **-99.5%**   |
| **下载时间**  | 数分钟    | **数秒** | **快 100x+** |
| **支持约束**  | 4,194,304 | 32,768   | 足够         |
| **电路约束**  | ~12K      | ~12K     | 不变         |
| **安全余量**  | 344x      | **2.7x** | 合理         |

---

## 🎯 优化理由

### 电路约束分析

**claim_first_receipt.circom**:

- Poseidon hash: ~100 约束/次
- 20 层 Merkle proof: ~2,000 约束
- 其他逻辑: ~10,000 约束
- **总计: ~12,166 约束**

### PTAU 选择

根据约束数 12,166:

- 需要: 2^14 = 16,384 约束 (PTAU 14)
- **推荐: 2^15 = 32,768 约束 (PTAU 15)** ⭐
- 过大: 2^22 = 4,194,304 约束 (PTAU 22)

**选择 PTAU 15 的原因**:

1. ✅ 2.7x 安全余量（足够）
2. ✅ 文件小（22MB，易下载）
3. ✅ 适合开发和 CI/CD
4. ✅ 无需 PTAU 22 的 344x 冗余

---

## 🔧 实施更改

### 1. 更新构建脚本

**文件**: `scripts/build_circuit.sh`

```diff
- PTAU_FILE="powersOfTau28_hez_final_22.ptau"
+ PTAU_FILE="powersOfTau28_hez_final_15.ptau"  # 22MB, 支持 32K 约束 (本电路 ~12K)
```

### 2. 添加自动下载

```bash
# 脚本会自动检查并下载 PTAU 文件
if [ ! -f "$PTAU_FILE" ]; then
    echo "下载 PTAU 15 (22MB)..."
    wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_15.ptau
fi
```

### 3. 更新文档

- `PTAU_SIZE_GUIDE.md`: 标记为"已采用"
- 添加当前项目状态说明

---

## 📋 使用方法

### 编译电路

```bash
# 脚本会自动下载 PTAU 15（如果不存在）
chmod +x scripts/build_circuit.sh
./scripts/build_circuit.sh
```

**首次运行**:

- 自动下载 PTAU 15 (22MB, 数秒)
- 编译电路
- 生成 zKey
- 生成 Verifier 合约

**后续运行**:

- 直接使用已下载的 PTAU 文件
- 快速编译

---

## ✅ 验证

### 文件检查

```bash
# 检查 PTAU 文件
ls -lh powersOfTau28_hez_final_15.ptau
# 应该显示 ~22M

# 检查构建输出
ls -lh circuits/out/claim_first_receipt_final.zkey
# 应该显示 ~62M
```

### 测试验证

```bash
# 运行测试（使用真实 ZK Proof）
npx hardhat test test/e2e.test.js
```

**预期结果**:

- ✅ ZK proof 生成成功
- ✅ 链上验证通过
- ✅ Gas: ~962K

---

## 📈 优势总结

### 1. 开发体验

- ✅ **快速下载**: 秒级 vs 分钟级
- ✅ **快速迭代**: 无需等待大文件
- ✅ **易于分享**: 22MB vs 4.5GB

### 2. CI/CD 友好

- ✅ **快速构建**: 无需缓存大文件
- ✅ **低存储**: 节省 CI/CD 存储空间
- ✅ **快速部署**: 整体构建时间减少

### 3. 存储优化

- ✅ **本地存储**: 节省 4.5GB 空间
- ✅ **Git LFS**: 无需存储大文件
- ✅ **团队协作**: 更容易同步

### 4. 安全性

- ✅ **足够余量**: 2.7x 安全余量
- ✅ **官方来源**: Hermez Powers of Tau
- ✅ **验证完整**: 可验证 PTAU 完整性

---

## 🔍 技术细节

### PTAU 文件说明

**Powers of Tau**:

- 可信设置仪式的输出
- Groth16 协议必需
- 文件大小 = 2^n × 约束复杂度

**PTAU 15 详情**:

- 最大约束: 2^15 = 32,768
- 文件大小: ~22MB
- 下载地址: https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_15.ptau

### 约束计算

```
电路约束: ~12,166
log2(12,166) ≈ 13.57

需要 PTAU: ≥ 14
推荐 PTAU: 15 (2.7x 余量)
```

---

## 📚 相关文档

- `PTAU_SIZE_GUIDE.md`: 详细的 PTAU 选择指南
- `scripts/build_circuit.sh`: 更新后的构建脚本
- `REAL_ZK_PROOF_GUIDE.md`: ZK Proof 使用指南

---

## ⚠️ 注意事项

### 电路修改

如果未来修改电路导致约束数增加：

| 约束数 | 需要 PTAU | 文件大小 | 说明         |
| ------ | --------- | -------- | ------------ |
| < 16K  | PTAU 14   | 8MB      | 基本够用     |
| < 32K  | PTAU 15   | 22MB     | **当前使用** |
| < 64K  | PTAU 16   | 44MB     | 更大电路     |
| < 1M   | PTAU 20   | 700MB    | 复杂电路     |

**检查约束数**:

```bash
snarkjs r1cs info circuits/out/claim_from_state_root.r1cs | grep constraints
```

### 重新编译

如果需要更大的 PTAU：

```bash
# 修改 scripts/build_circuit.sh
PTAU_FILE="powersOfTau28_hez_final_16.ptau"  # 或更大

# 重新编译
./scripts/build_circuit.sh
```

---

## ✅ 完成检查

- [x] 更新构建脚本使用 PTAU 15
- [x] 添加自动下载逻辑
- [x] 更新相关文档
- [x] 验证文件大小减少
- [x] 测试构建流程正常

---

**优化完成日期**: 2025-10-12  
**状态**: ✅ **已优化，使用刚好够用的 PTAU 文件**  
**节省**: 4.5GB → 22MB (-99.5%)
