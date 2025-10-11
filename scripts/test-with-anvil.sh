#!/bin/bash
set -euo pipefail

echo "=== 使用 Anvil 运行真实 ZK Proof 测试 ==="
echo ""

# 检查 anvil 是否安装
if ! command -v anvil &> /dev/null; then
    echo "❌ Anvil 未安装"
    echo "请安装 Foundry: curl -L https://foundry.paradigm.xyz | bash"
    echo "然后运行: foundryup"
    exit 1
fi

echo "✅ Anvil 已安装"
echo ""

# 启动 Anvil
echo "🚀 启动 Anvil..."
anvil --port 8545 &
ANVIL_PID=$!

# 等待 Anvil 启动
sleep 3

echo "✅ Anvil 已启动 (PID: $ANVIL_PID)"
echo ""

# 清理函数
cleanup() {
    echo ""
    echo "🛑 停止 Anvil..."
    kill $ANVIL_PID 2>/dev/null || true
    exit
}

trap cleanup EXIT INT TERM

# 运行测试
echo "🧪 运行真实 ZK Proof 测试..."
echo "⚠️  注意：生成证明需要时间，请耐心等待..."
echo ""

# 设置 Hardhat 使用 Anvil
export HARDHAT_NETWORK=localhost

npx hardhat test test/e2e-with-real-proof.test.js --network localhost

echo ""
echo "✅ 测试完成"

