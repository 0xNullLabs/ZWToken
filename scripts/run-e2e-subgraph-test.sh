#!/bin/bash

# 真正的 Subgraph E2E 测试运行脚本
# 这个脚本会启动 Hardhat 节点，然后运行测试

set -e

echo "🚀 启动 Hardhat 节点..."
npx hardhat node &
HARDHAT_PID=$!

echo "⏳ 等待 Hardhat 节点就绪..."
sleep 5

echo "🧪 运行测试..."
npx hardhat test test/e2e-real-subgraph.test.js --network localhost || TEST_FAILED=1

echo "🛑 停止 Hardhat 节点..."
kill $HARDHAT_PID 2>/dev/null || true

if [ "$TEST_FAILED" = "1" ]; then
  echo "❌ 测试失败"
  exit 1
fi

echo "✅ 测试成功"

