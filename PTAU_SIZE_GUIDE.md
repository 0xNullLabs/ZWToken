# PTAU 文件大小指南

## 📊 电路约束数

我们的电路：`claim_first_receipt.circom`

- **约束数**: 12,166

## 🎯 PTAU 文件选择

### PTAU 大小对比

| PTAU   | 支持约束数     | 文件大小 | 是否够用 | 推荐        |
| ------ | -------------- | -------- | -------- | ----------- |
| **14** | 16,384 (2^14)  | ~11 MB   | ✅ 够用  | ⚠️ 边缘     |
| **15** | 32,768 (2^15)  | ~22 MB   | ✅ 够用  | ✅ **推荐** |
| **16** | 65,536 (2^16)  | ~44 MB   | ✅ 够用  | ✅ 推荐     |
| 17     | 131,072        | ~88 MB   | ✅       | -           |
| 18     | 262,144        | ~176 MB  | ✅       | -           |
| **19** | 524,288 (2^19) | ~350 MB  | ✅       | ⚠️ 偏大     |
| 22     | 4,194,304      | ~2.8 GB  | ✅       | ❌ 太大     |
| 28     | 268,435,456    | ~45 GB   | ✅       | ❌ **过大** |

### 计算公式

```
需要的 PTAU 大小 = ceil(log2(约束数)) + 安全余量

12,166 约束 → log2(12,166) ≈ 13.57
→ 至少需要 PTAU 14
→ **推荐 PTAU 15 或 16**（2-4 倍余量）
```

## 🎯 推荐方案

### 方案 1: PTAU 15（推荐）⭐ ✅ 已采用

**下载**：

```bash
wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_15.ptau
```

**优点**：

- ✅ 文件小（~22 MB vs 4.5 GB）
- ✅ 下载快（秒级 vs 分钟级）
- ✅ 2.7x 余量（32,768 vs 12,166）
- ✅ 足够安全

**适用**：

- 日常开发
- CI/CD
- 快速迭代

### 方案 2: PTAU 16

**下载**：

```bash
wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_16.ptau
```

**优点**：

- ✅ 文件较小（~44 MB）
- ✅ 5.4x 余量（65,536 vs 12,166）
- ✅ 更多安全边界

**适用**：

- 需要更多余量
- 电路可能增长

### 方案 3: PTAU 19

**下载**：

```bash
wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_19.ptau
```

**特点**：

- ⚠️ 较大（~350 MB）
- ✅ 43x 余量
- 适合需要支持更大电路

## 🚀 切换到小 PTAU

### 步骤 1: 删除旧的 PTAU（可选）

```bash
# 备份（如果需要）
mv powersOfTau28_hez_final_22.ptau powersOfTau28_hez_final_22.ptau.bak

# 或直接删除
rm powersOfTau28_hez_final_22.ptau
```

### 步骤 2: 下载推荐的 PTAU

```bash
# 推荐：PTAU 15 (22 MB)
wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_15.ptau
```

### 步骤 3: 修改构建脚本

编辑 `scripts/build_circuit.sh`：

```bash
# 将
PTAU_FILE="powersOfTau28_hez_final_22.ptau"

# 改为
PTAU_FILE="powersOfTau28_hez_final_15.ptau"
```

### 步骤 4: 重新编译

```bash
./scripts/build_circuit.sh
```

## 📊 性能对比

### 下载时间（100 Mbps 网速）

| PTAU | 大小   | 下载时间     |
| ---- | ------ | ------------ |
| 15   | 22 MB  | **~2 秒** ⚡ |
| 16   | 44 MB  | ~4 秒        |
| 19   | 350 MB | ~30 秒       |
| 22   | 2.8 GB | ~4 分钟      |
| 28   | 45 GB  | ~60 分钟     |

### CI/CD 影响

**使用 PTAU 15**：

- ✅ 可以直接在 CI 中下载（秒级）
- ✅ 无需缓存
- ✅ 构建快速

**使用 PTAU 22/28**：

- ❌ 必须缓存（否则每次几分钟）
- ❌ 占用 CI 存储
- ❌ 增加构建时间

## 💡 最佳实践

### 开发环境

```bash
# 使用 PTAU 15（快速）
wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_15.ptau
```

### 生产环境

```bash
# 使用 PTAU 16（更多余量）
wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_16.ptau
```

### CI/CD

```yaml
# GitHub Actions 示例
- name: Download PTAU
  run: wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_15.ptau
  # 无需缓存，直接下载（秒级）
```

## 🔧 当前项目状态

### ✅ 已更新使用 PTAU 15

构建脚本 `scripts/build_circuit.sh` 已更新：

- PTAU 文件：`powersOfTau28_hez_final_15.ptau` (22MB)
- 自动下载：如果文件不存在，脚本会自动下载
- 支持约束：32,768（电路约束 ~12K）

**运行构建**：

```bash
./scripts/build_circuit.sh
```

**优势**：

- ✅ 文件小（22MB vs 4.5GB）
- ✅ 快速下载（秒级）
- ✅ 足够的安全余量（2.7x）
- ✅ 适合开发和 CI/CD

---

**日期**: 2025-10-12  
**状态**: ✅ 已优化为刚好够用的 PTAU 文件
