const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("deployer:", deployer.address);

  const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
  const underlying = await MockERC20.deploy(
    "Underlying Token",
    "UND",
    hre.ethers.parseEther("1000000")
  );
  await underlying.waitForDeployment();
  console.log("underlying:", await underlying.getAddress());

  const Ver = await hre.ethers.getContractFactory("DevMockVerifier");
  const ver = await Ver.deploy();
  await ver.waitForDeployment();
  console.log("verifier:", await ver.getAddress());

  const Token = await hre.ethers.getContractFactory("ZWToken");
  const token = await Token.deploy(
    "ZK Wrapped Token",
    "ZKW",
    await underlying.getAddress(),
    await ver.getAddress(),
    10
  );
  await token.waitForDeployment();
  console.log("token:", await token.getAddress());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
