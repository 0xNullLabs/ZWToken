#!/usr/bin/env node

/**
 * 检查 Subgraph 集成测试环境
 *
 * 验证所有必需的依赖和服务是否就绪
 */

const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);
const fs = require("fs");
const path = require("path");

const checks = [];
let allPassed = true;

function log(emoji, message, details = "") {
  console.log(`${emoji} ${message}`);
  if (details) {
    console.log(`   ${details}`);
  }
}

function pass(name, details) {
  checks.push({ name, status: "✅", details });
  log("✅", name, details);
}

function fail(name, details, solution) {
  checks.push({ name, status: "❌", details });
  log("❌", name, details);
  if (solution) {
    console.log(`   💡 解决方案: ${solution}`);
  }
  allPassed = false;
}

function warn(name, details) {
  checks.push({ name, status: "⚠️", details });
  log("⚠️", name, details);
}

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("🔍 Subgraph 集成测试 - 环境检查");
  console.log("=".repeat(70) + "\n");

  // 1. 检查 Node.js 版本
  console.log("📦 检查 Node.js 和 npm...\n");
  try {
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split(".")[0]);

    if (majorVersion >= 16) {
      pass("Node.js 版本", `${nodeVersion} (推荐 >= 16)`);
    } else {
      warn("Node.js 版本", `${nodeVersion} (推荐 >= 16)`);
    }
  } catch (error) {
    fail("Node.js", "未安装", "https://nodejs.org/");
  }

  // 2. 检查 Docker
  console.log("\n🐳 检查 Docker...\n");
  try {
    const { stdout } = await execPromise("docker --version");
    pass("Docker 已安装", stdout.trim());

    // 检查 Docker 是否运行
    try {
      await execPromise("docker info");
      pass("Docker 正在运行", "");
    } catch (error) {
      fail(
        "Docker 未运行",
        "Docker 守护进程未启动",
        '启动 Docker Desktop 或运行 "sudo systemctl start docker"'
      );
    }
  } catch (error) {
    fail(
      "Docker 未安装",
      "无法找到 docker 命令",
      "安装 Docker Desktop: https://www.docker.com/products/docker-desktop"
    );
  }

  // 3. 检查 Docker Compose
  console.log("\n🐳 检查 Docker Compose...\n");
  try {
    const { stdout } = await execPromise("docker-compose --version").catch(() =>
      execPromise("docker compose version")
    );
    pass("Docker Compose 已安装", stdout.trim());
  } catch (error) {
    fail(
      "Docker Compose 未安装",
      "无法找到 docker-compose 命令",
      "通常随 Docker Desktop 一起安装"
    );
  }

  // 4. 检查 Graph CLI
  console.log("\n📊 检查 Graph CLI...\n");
  try {
    const { stdout } = await execPromise("npx graph --version");
    pass("Graph CLI 可用", stdout.trim());
  } catch (error) {
    warn("Graph CLI", "未全局安装（使用 npx 运行）");
  }

  // 5. 检查项目文件
  console.log("\n📁 检查项目文件...\n");

  const projectRoot = path.join(__dirname, "..");

  // 检查电路文件
  const wasmPath = path.join(
    projectRoot,
    "circuits/out/claim_first_receipt_js/claim_first_receipt.wasm"
  );
  const zkeyPath = path.join(
    projectRoot,
    "circuits/out/claim_first_receipt_final.zkey"
  );

  if (fs.existsSync(wasmPath) && fs.existsSync(zkeyPath)) {
    pass("电路文件", "WASM 和 zKey 文件已编译");
  } else {
    fail(
      "电路文件未编译",
      "缺少 WASM 或 zKey 文件",
      "运行 ./scripts/build_circuit.sh"
    );
  }

  // 检查 Subgraph 文件
  const subgraphFiles = [
    "subgraph/schema.graphql",
    "subgraph/subgraph.yaml",
    "subgraph/src/mapping.ts",
    "subgraph/docker-compose.yml",
  ];

  let subgraphFilesOk = true;
  for (const file of subgraphFiles) {
    const filePath = path.join(projectRoot, file);
    if (!fs.existsSync(filePath)) {
      fail(`缺少文件: ${file}`, "", "");
      subgraphFilesOk = false;
    }
  }

  if (subgraphFilesOk) {
    pass("Subgraph 配置文件", "所有必需文件存在");
  }

  // 检查 Subgraph 依赖
  const subgraphNodeModules = path.join(projectRoot, "subgraph/node_modules");
  if (fs.existsSync(subgraphNodeModules)) {
    pass("Subgraph 依赖", "node_modules 已安装");
  } else {
    fail(
      "Subgraph 依赖未安装",
      "subgraph/node_modules 不存在",
      '运行 "cd subgraph && npm install"'
    );
  }

  // 6. 检查端口占用
  console.log("\n🔌 检查端口占用...\n");

  const ports = [
    { port: 8545, service: "Hardhat 节点" },
    { port: 8000, service: "Graph Node HTTP" },
    { port: 8020, service: "Graph Node Admin" },
    { port: 5001, service: "IPFS" },
    { port: 5432, service: "PostgreSQL" },
  ];

  for (const { port, service } of ports) {
    try {
      const { stdout } = await execPromise(`lsof -ti:${port}`).catch(() => ({
        stdout: "",
      }));
      if (stdout.trim()) {
        warn(`端口 ${port} (${service})`, "已被占用", `PID: ${stdout.trim()}`);
      } else {
        pass(`端口 ${port} (${service})`, "可用");
      }
    } catch (error) {
      // lsof 命令可能不存在（Windows）
      pass(`端口 ${port} (${service})`, "无法检查（可能需要手动验证）");
    }
  }

  // 7. 检查磁盘空间
  console.log("\n💾 检查磁盘空间...\n");
  try {
    const { stdout } = await execPromise("df -h .").catch(() => ({
      stdout: "",
    }));
    if (stdout) {
      const lines = stdout.trim().split("\n");
      if (lines.length > 1) {
        const spaceInfo = lines[1].split(/\s+/);
        const available = spaceInfo[3];
        pass("磁盘空间", `可用: ${available}`);
      }
    }
  } catch (error) {
    // Windows 或其他系统
    pass("磁盘空间", "无法检查（假设充足）");
  }

  // 总结
  console.log("\n" + "=".repeat(70));
  console.log("📊 检查总结");
  console.log("=".repeat(70) + "\n");

  const passed = checks.filter((c) => c.status === "✅").length;
  const failed = checks.filter((c) => c.status === "❌").length;
  const warned = checks.filter((c) => c.status === "⚠️").length;

  console.log(`✅ 通过: ${passed}`);
  console.log(`❌ 失败: ${failed}`);
  console.log(`⚠️  警告: ${warned}`);
  console.log(`📝 总计: ${checks.length}\n`);

  if (allPassed) {
    console.log("🎉 环境检查通过！可以运行集成测试。\n");
    console.log("💡 运行测试:");
    console.log("   npx hardhat test test/e2e-real-subgraph.test.js\n");
    process.exit(0);
  } else {
    console.log("⚠️  存在问题需要解决。\n");
    console.log("📚 查看详细指南:");
    console.log("   test/REAL_SUBGRAPH_TEST_GUIDE.md\n");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("\n❌ 检查过程出错:", error.message);
  process.exit(1);
});
