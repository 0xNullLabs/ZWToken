const { expect } = require("chai");
const { ethers } = require("hardhat");

function zbytes32(hex) {
  return ethers.zeroPadValue(hex, 32);
}

describe("ZWToken claim (mock verifier)", function () {
  it("mints on valid claim and prevents double-claim via nullifier", async function () {
    const [deployer, recipient] = await ethers.getSigners();

    // Deploy MockERC20 as underlying token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const underlying = await MockERC20.deploy(
      "Underlying Token",
      "UND",
      ethers.parseEther("1000000")
    );
    await underlying.waitForDeployment();

    const Ver = await ethers.getContractFactory("DevMockVerifier");
    const ver = await Ver.deploy();
    await ver.waitForDeployment();

    const Token = await ethers.getContractFactory("ZWToken");
    const token = await Token.deploy(
      "ZK Claim Token",
      "ZKC",
      await underlying.getAddress(),
      await ver.getAddress(),
      10
    );
    await token.waitForDeployment();

    // Mine a couple blocks to have head-2 available
    await ethers.provider.send("hardhat_mine", ["0x3"]);
    const head = await ethers.provider.getBlockNumber();
    const B = head - 2;
    const blk = await ethers.provider.getBlock(B);

    const headerHash = blk.hash; // equals blockhash(B)
    const stateRoot = ethers.ZeroHash; // not used by DevMockVerifier
    const amount = 1234n;
    const to = await recipient.getAddress();
    const nullifier = zbytes32("0xdeadbeef");

    // snarkjs-style proof params (dummy values)
    const a = [1n, 2n];
    const b = [
      [3n, 4n],
      [5n, 6n],
    ];
    const c = [7n, 8n];

    // First claim should succeed
    await expect(
      token
        .connect(deployer)
        .claim(a, b, c, headerHash, B, stateRoot, amount, nullifier, to)
    )
      .to.emit(token, "Claimed")
      .withArgs(nullifier, to, amount);

    // Balance increased
    const bal = await token.balanceOf(to);
    expect(bal).to.equal(amount);

    // Reuse same nullifier should revert
    await expect(
      token
        .connect(deployer)
        .claim(a, b, c, headerHash, B, stateRoot, amount, nullifier, to)
    ).to.be.revertedWith("nullifier used");
  });
});
