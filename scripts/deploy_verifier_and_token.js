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

  const Groth16Verifier = await hre.ethers.getContractFactory(
    "Groth16Verifier"
  );
  const verifier = await Groth16Verifier.deploy();
  await verifier.waitForDeployment();
  console.log("verifier:", await verifier.getAddress());

  const Token = await hre.ethers.getContractFactory("ZWToken");
  const token = await Token.deploy(
    "ZK Wrapped Token",
    "ZKW",
    await underlying.getAddress(),
    await verifier.getAddress(),
    10
  );
  await token.waitForDeployment();
  console.log("token:", await token.getAddress());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
