const { expect } = require("chai");
const { ethers } = require("hardhat");
const { IncrementalMerkleTree } = require("../utils/merkle-tree-utils");
const {
  createZWConfig,
  derivePrivacyAddress,
  calculateNullifier,
  generateZKProof,
  encodeProverData,
  deployPoseidonT3,
  deployVerifier,
  poseidon,
} = require("./helpers/test-utils");

describe("ZWERC20 - Anonymous Cap & Revealed Remint", function () {
  let zwToken, underlying, verifier, poseidonT3;
  let deployer, alice, bob;

  const SECRET = 777888999n;
  const ANONYMOUS_CAP = ethers.parseEther("100");

  before(async function () {
    [deployer, alice, bob] = await ethers.getSigners();

    poseidonT3 = await deployPoseidonT3();
    verifier = await deployVerifier();

    const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
    underlying = await ERC20Mock.deploy(
      "Underlying Token",
      "UDLT",
      ethers.parseEther("1000000")
    );
    await underlying.waitForDeployment();

    const ZWERC20 = await ethers.getContractFactory(
      "contracts/ZWERC20.sol:ZWERC20",
      { libraries: { PoseidonT3: await poseidonT3.getAddress() } }
    );

    const config = createZWConfig(
      await verifier.getAddress(),
      deployer.address,
      { anonymousCap: ANONYMOUS_CAP }
    );

    zwToken = await ZWERC20.deploy(
      "ZK Wrapper Token",
      "ZWT",
      18,
      await underlying.getAddress(),
      config
    );
    await zwToken.waitForDeployment();

    await underlying.transfer(alice.address, ethers.parseEther("10000"));
  });

  async function setupCommitment(secret, commitAmount) {
    const tokenId = 0n;
    const { addr20, q, privacyAddress } = derivePrivacyAddress(tokenId, secret);

    await underlying
      .connect(alice)
      .approve(await zwToken.getAddress(), commitAmount);
    await zwToken
      .connect(alice)
      .deposit(alice.address, 0, commitAmount, "0x");
    await zwToken.connect(alice).transfer(privacyAddress, commitAmount);

    const leafCount = await zwToken.getCommitLeafCount(0);
    const [, recipients, amounts] = await zwToken.getCommitLeaves(
      0,
      0,
      leafCount
    );

    const tree = new IncrementalMerkleTree(20);
    for (let i = 0; i < recipients.length; i++) {
      tree.insert(poseidon([BigInt(recipients[i]), BigInt(amounts[i])]));
    }

    const localRoot = "0x" + tree.root.toString(16).padStart(64, "0");
    const commitment = poseidon([addr20, BigInt(commitAmount)]);
    const commitmentIndex = tree.leaves.findIndex(
      (leaf) => BigInt(leaf) === commitment
    );
    const merkleProof = tree.getProof(commitmentIndex);
    const { nullifier, nullifierHex } = calculateNullifier(addr20, secret);

    return {
      addr20,
      q,
      privacyAddress,
      tree,
      localRoot,
      merkleProof,
      nullifier,
      nullifierHex,
      commitAmount,
    };
  }

  it("anonymousCap is set correctly", async function () {
    expect(await zwToken.anonymousCap()).to.equal(ANONYMOUS_CAP);
  });

  it("amount <= cap: anonymous remint succeeds", async function () {
    this.timeout(180000);

    const secret = 100000001n;
    const commitAmt = ethers.parseEther("80");
    const remintAmt = ethers.parseEther("50");

    const ctx = await setupCommitment(secret, commitAmt);

    const circuitInput = {
      root: ctx.tree.root,
      nullifier: ctx.nullifier,
      to: BigInt(bob.address),
      remintAmount: BigInt(remintAmt),
      id: 0n,
      redeem: 0n,
      relayerFee: 0n,
      revealedAddr: 0n,
      secret: secret,
      addr20: ctx.addr20,
      commitAmount: BigInt(commitAmt),
      q: ctx.q,
      pathElements: ctx.merkleProof.pathElements.map((e) => BigInt(e)),
      pathIndices: ctx.merkleProof.pathIndices,
    };

    const { proofBytes } = await generateZKProof(circuitInput);

    await expect(
      zwToken.remint(bob.address, 0, remintAmt, {
        commitment: ctx.localRoot,
        nullifiers: [ctx.nullifierHex],
        proverData: "0x",
        relayerData: "0x",
        redeem: false,
        proof: proofBytes,
      })
    ).to.emit(zwToken, "Reminted");
  });

  it("amount > cap without reveal: reverts with RevealRequired", async function () {
    this.timeout(180000);

    const secret = 100000002n;
    const commitAmt = ethers.parseEther("200");
    const remintAmt = ethers.parseEther("150");

    const ctx = await setupCommitment(secret, commitAmt);

    const circuitInput = {
      root: ctx.tree.root,
      nullifier: ctx.nullifier,
      to: BigInt(bob.address),
      remintAmount: BigInt(remintAmt),
      id: 0n,
      redeem: 0n,
      relayerFee: 0n,
      revealedAddr: 0n,
      secret: secret,
      addr20: ctx.addr20,
      commitAmount: BigInt(commitAmt),
      q: ctx.q,
      pathElements: ctx.merkleProof.pathElements.map((e) => BigInt(e)),
      pathIndices: ctx.merkleProof.pathIndices,
    };

    const { proofBytes } = await generateZKProof(circuitInput);

    await expect(
      zwToken.remint(bob.address, 0, remintAmt, {
        commitment: ctx.localRoot,
        nullifiers: [ctx.nullifierHex],
        proverData: "0x",
        relayerData: "0x",
        redeem: false,
        proof: proofBytes,
      })
    ).to.be.revertedWithCustomError(zwToken, "RevealRequired");
  });

  it("amount > cap with reveal: burns from burnAddr, no inflation", async function () {
    this.timeout(180000);

    const secret = 100000003n;
    const commitAmt = ethers.parseEther("200");
    const remintAmt = ethers.parseEther("150");

    const ctx = await setupCommitment(secret, commitAmt);

    const circuitInput = {
      root: ctx.tree.root,
      nullifier: ctx.nullifier,
      to: BigInt(bob.address),
      remintAmount: BigInt(remintAmt),
      id: 0n,
      redeem: 0n,
      relayerFee: 0n,
      revealedAddr: ctx.addr20,
      secret: secret,
      addr20: ctx.addr20,
      commitAmount: BigInt(commitAmt),
      q: ctx.q,
      pathElements: ctx.merkleProof.pathElements.map((e) => BigInt(e)),
      pathIndices: ctx.merkleProof.pathIndices,
    };

    const { proofBytes } = await generateZKProof(circuitInput);

    const totalSupplyBefore = await zwToken.totalSupply();
    const burnAddrBalanceBefore = await zwToken.balanceOf(ctx.privacyAddress);
    const bobBalanceBefore = await zwToken.balanceOf(bob.address);

    const proverData = encodeProverData(ctx.privacyAddress);

    await expect(
      zwToken.remint(bob.address, 0, remintAmt, {
        commitment: ctx.localRoot,
        nullifiers: [ctx.nullifierHex],
        proverData: proverData,
        relayerData: "0x",
        redeem: false,
        proof: proofBytes,
      })
    ).to.emit(zwToken, "Reminted");

    const totalSupplyAfter = await zwToken.totalSupply();
    const burnAddrBalanceAfter = await zwToken.balanceOf(ctx.privacyAddress);
    const bobBalanceAfter = await zwToken.balanceOf(bob.address);

    // Total supply unchanged (burn + mint cancel out)
    expect(totalSupplyAfter).to.equal(totalSupplyBefore);

    // Burn address balance decreased
    expect(burnAddrBalanceBefore - burnAddrBalanceAfter).to.equal(remintAmt);

    // Bob received tokens
    expect(bobBalanceAfter - bobBalanceBefore).to.equal(remintAmt);
  });

  it("amount > cap with reveal + redeem: burns from burnAddr, sends underlying", async function () {
    this.timeout(180000);

    const secret = 100000004n;
    const commitAmt = ethers.parseEther("200");
    const remintAmt = ethers.parseEther("150");

    const ctx = await setupCommitment(secret, commitAmt);

    const circuitInput = {
      root: ctx.tree.root,
      nullifier: ctx.nullifier,
      to: BigInt(bob.address),
      remintAmount: BigInt(remintAmt),
      id: 0n,
      redeem: 1n,
      relayerFee: 0n,
      revealedAddr: ctx.addr20,
      secret: secret,
      addr20: ctx.addr20,
      commitAmount: BigInt(commitAmt),
      q: ctx.q,
      pathElements: ctx.merkleProof.pathElements.map((e) => BigInt(e)),
      pathIndices: ctx.merkleProof.pathIndices,
    };

    const { proofBytes } = await generateZKProof(circuitInput);

    const totalSupplyBefore = await zwToken.totalSupply();
    const bobUnderlyingBefore = await underlying.balanceOf(bob.address);

    const proverData = encodeProverData(ctx.privacyAddress);

    await expect(
      zwToken.remint(bob.address, 0, remintAmt, {
        commitment: ctx.localRoot,
        nullifiers: [ctx.nullifierHex],
        proverData: proverData,
        relayerData: "0x",
        redeem: true,
        proof: proofBytes,
      })
    ).to.emit(zwToken, "Reminted");

    const totalSupplyAfter = await zwToken.totalSupply();
    const bobUnderlyingAfter = await underlying.balanceOf(bob.address);

    // Total supply decreased by remintAmt (burn from burnAddr, underlying sent out)
    expect(totalSupplyBefore - totalSupplyAfter).to.equal(remintAmt);

    // Bob received underlying
    expect(bobUnderlyingAfter - bobUnderlyingBefore).to.equal(remintAmt);
  });

  it("revealed addr with code: reverts with BurnAddressHasCode", async function () {
    this.timeout(180000);

    const secret = 100000005n;
    const commitAmt = ethers.parseEther("200");
    const remintAmt = ethers.parseEther("150");

    const ctx = await setupCommitment(secret, commitAmt);

    const circuitInput = {
      root: ctx.tree.root,
      nullifier: ctx.nullifier,
      to: BigInt(bob.address),
      remintAmount: BigInt(remintAmt),
      id: 0n,
      redeem: 0n,
      relayerFee: 0n,
      revealedAddr: BigInt(await zwToken.getAddress()),
      secret: secret,
      addr20: ctx.addr20,
      commitAmount: BigInt(commitAmt),
      q: ctx.q,
      pathElements: ctx.merkleProof.pathElements.map((e) => BigInt(e)),
      pathIndices: ctx.merkleProof.pathIndices,
    };

    // ZK proof will fail because revealedAddr != addr20, but contract checks
    // BurnAddressHasCode before proof verification. Use mock verifier to test.
    // Since we're using real verifier here, the proof for wrong revealedAddr
    // won't generate. Instead, use the MockVerifier-based approach.

    // Deploy a new contract with MockVerifier for this specific test
    const MockVerifier = await ethers.getContractFactory("MockVerifier");
    const mockVerifier = await MockVerifier.deploy();

    const ZWERC20 = await ethers.getContractFactory(
      "contracts/ZWERC20.sol:ZWERC20",
      { libraries: { PoseidonT3: await poseidonT3.getAddress() } }
    );

    const config = createZWConfig(
      await mockVerifier.getAddress(),
      deployer.address,
      { anonymousCap: ANONYMOUS_CAP }
    );

    const mockZwToken = await ZWERC20.deploy(
      "ZK Wrapper Token Mock",
      "ZWTM",
      18,
      await underlying.getAddress(),
      config
    );
    await mockZwToken.waitForDeployment();

    // Setup: deposit and transfer to privacy address
    await underlying.transfer(alice.address, commitAmt);
    await underlying
      .connect(alice)
      .approve(await mockZwToken.getAddress(), commitAmt);
    await mockZwToken
      .connect(alice)
      .deposit(alice.address, 0, commitAmt, "0x");

    const tokenId = 0n;
    const { privacyAddress } = derivePrivacyAddress(tokenId, secret);
    await mockZwToken.connect(alice).transfer(privacyAddress, commitAmt);

    const root = await mockZwToken.root();
    const nullifier = ethers.id("test-nullifier-code-check");

    const dummyProof = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256[2]", "uint256[2][2]", "uint256[2]"],
      [[0, 0], [[0, 0], [0, 0]], [0, 0]]
    );

    // Use a contract address (mockVerifier itself) as revealedAddr
    const contractAddr = await mockVerifier.getAddress();
    const proverData = encodeProverData(contractAddr);

    await expect(
      mockZwToken.remint(bob.address, 0, remintAmt, {
        commitment: root,
        nullifiers: [nullifier],
        proverData: proverData,
        relayerData: "0x",
        redeem: false,
        proof: dummyProof,
      })
    ).to.be.revertedWithCustomError(mockZwToken, "BurnAddressHasCode");
  });

  it("amount <= cap with voluntary reveal still works", async function () {
    this.timeout(180000);

    const secret = 100000006n;
    const commitAmt = ethers.parseEther("80");
    const remintAmt = ethers.parseEther("50");

    const ctx = await setupCommitment(secret, commitAmt);

    const circuitInput = {
      root: ctx.tree.root,
      nullifier: ctx.nullifier,
      to: BigInt(bob.address),
      remintAmount: BigInt(remintAmt),
      id: 0n,
      redeem: 0n,
      relayerFee: 0n,
      revealedAddr: ctx.addr20,
      secret: secret,
      addr20: ctx.addr20,
      commitAmount: BigInt(commitAmt),
      q: ctx.q,
      pathElements: ctx.merkleProof.pathElements.map((e) => BigInt(e)),
      pathIndices: ctx.merkleProof.pathIndices,
    };

    const { proofBytes } = await generateZKProof(circuitInput);

    const totalSupplyBefore = await zwToken.totalSupply();
    const proverData = encodeProverData(ctx.privacyAddress);

    await expect(
      zwToken.remint(bob.address, 0, remintAmt, {
        commitment: ctx.localRoot,
        nullifiers: [ctx.nullifierHex],
        proverData: proverData,
        relayerData: "0x",
        redeem: false,
        proof: proofBytes,
      })
    ).to.emit(zwToken, "Reminted");

    // Voluntary reveal: totalSupply unchanged
    const totalSupplyAfter = await zwToken.totalSupply();
    expect(totalSupplyAfter).to.equal(totalSupplyBefore);
  });
});
