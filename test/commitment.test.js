const { expect } = require("chai");
const { ethers } = require("hardhat");
const { poseidon } = require("circomlibjs");

/**
 * Helper: 将 Groth16 proof 编码为 bytes
 */
function encodeProof(a, b, c) {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  return abiCoder.encode(
    ["uint256[2]", "uint256[2][2]", "uint256[2]"],
    [a, b, c]
  );
}

describe("ZWERC20 - Commitment Recording", function () {
  let zwToken, underlying, verifier, poseidonT3;
  let owner, alice, bob, charlie;

  beforeEach(async function () {
    [owner, alice, bob, charlie] = await ethers.getSigners();

    // Deploy PoseidonT3 library
    const PoseidonT3 = await ethers.getContractFactory(
      "poseidon-solidity/PoseidonT3.sol:PoseidonT3"
    );
    poseidonT3 = await PoseidonT3.deploy();
    await poseidonT3.waitForDeployment();

    // Deploy PoseidonT4 library
    const PoseidonT4 = await ethers.getContractFactory(
      "poseidon-solidity/PoseidonT4.sol:PoseidonT4"
    );
    poseidonT4 = await PoseidonT4.deploy();
    await poseidonT4.waitForDeployment();

    // Deploy mock underlying token
    const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
    underlying = await ERC20Mock.deploy(
      "Mock Token",
      "MOCK",
      ethers.parseEther("10000")
    );

    // Deploy mock verifier
    const MockVerifier = await ethers.getContractFactory("MockVerifier");
    verifier = await MockVerifier.deploy();

    // Deploy ZWERC20 with linked library (使用完全限定名避免歧义)
    const ZWERC20 = await ethers.getContractFactory(
      "contracts/ZWERC20.sol:ZWERC20",
      {
        libraries: {
          PoseidonT3: await poseidonT3.getAddress(),
        },
      }
    );
    const underlyingDecimals = await underlying.decimals();
    zwToken = await ZWERC20.deploy(
      "ZK Wrapper Token",
      "ZWT",
      underlyingDecimals, // 从 underlying token 获取 decimals
      await underlying.getAddress(),
      await verifier.getAddress(),
      owner.address, // feeCollector
      10000, // feeDenominator
      0, // depositFee (0%)
      0, // remintFee (0%)
      0 // withdrawFee (0%)
    );

    // Distribute underlying tokens
    await underlying.transfer(alice.address, ethers.parseEther("1000"));
    await underlying.transfer(bob.address, ethers.parseEther("1000"));
  });

  describe("Deposit - Should NOT record commitment", function () {
    it("Should not create commitment on deposit", async function () {
      await underlying
        .connect(alice)
        .approve(await zwToken.getAddress(), ethers.parseEther("100"));

      await zwToken
        .connect(alice)
        .depositTo(alice.address, 0, ethers.parseEther("100"));

      // Check no commitments were created
      const leafCount = await zwToken.getCommitLeafCount(0);
      expect(leafCount).to.equal(0);
    });

    it("Should not mark as first receipt recorded after deposit", async function () {
      await underlying
        .connect(alice)
        .approve(await zwToken.getAddress(), ethers.parseEther("100"));
      await zwToken
        .connect(alice)
        .depositTo(alice.address, 0, ethers.parseEther("100"));

      const hasRecorded = await zwToken.hasFirstReceiptRecorded(alice.address);
      expect(hasRecorded).to.be.false;
    });

    it("Should have 0 commitments after deposits", async function () {
      await underlying
        .connect(alice)
        .approve(await zwToken.getAddress(), ethers.parseEther("100"));
      await zwToken
        .connect(alice)
        .depositTo(alice.address, 0, ethers.parseEther("100"));

      await underlying
        .connect(bob)
        .approve(await zwToken.getAddress(), ethers.parseEther("100"));
      await zwToken
        .connect(bob)
        .depositTo(bob.address, 0, ethers.parseEther("100"));

      const count = await zwToken.getCommitLeafCount(0);
      expect(count).to.equal(0);
    });
  });

  describe("Transfer - Should record commitment on first receipt", function () {
    beforeEach(async function () {
      // Alice deposits
      await underlying
        .connect(alice)
        .approve(await zwToken.getAddress(), ethers.parseEther("100"));
      await zwToken
        .connect(alice)
        .depositTo(alice.address, 0, ethers.parseEther("100"));
    });

    it("Should create commitment on first transfer to Bob", async function () {
      const amount = ethers.parseEther("50");

      await zwToken.connect(alice).transfer(bob.address, amount);

      // Check commitment was created
      const leafCount = await zwToken.getCommitLeafCount(0);
      expect(leafCount).to.equal(1);

      // Verify the commitment data
      const [commitHashes, recipients, amounts] = await zwToken.getCommitLeaves(0, 0, 1);
      expect(recipients[0]).to.equal(bob.address);
      expect(amounts[0]).to.equal(amount);
    });

    it("Should record correct commitment value", async function () {
      const amount = ethers.parseEther("50");

      await zwToken.connect(alice).transfer(bob.address, amount);

      // Verify the commitment data matches expected values
      const [commitHashes, recipients, amounts] = await zwToken.getCommitLeaves(0, 0, 1);
      expect(recipients[0]).to.equal(bob.address);
      expect(amounts[0]).to.equal(amount);

      // Verify commitment count
      const leafCount = await zwToken.getCommitLeafCount(0);
      expect(leafCount).to.equal(1);
    });

    it("Should NOT create new commitment on second transfer to same recipient", async function () {
      // First transfer
      await zwToken
        .connect(alice)
        .transfer(bob.address, ethers.parseEther("50"));

      const leafCountAfterFirst = await zwToken.getCommitLeafCount(0);
      expect(leafCountAfterFirst).to.equal(1);

      // Second transfer
      await zwToken
        .connect(alice)
        .transfer(bob.address, ethers.parseEther("20"));

      // Should still have only 1 commitment
      const leafCountAfterSecond = await zwToken.getCommitLeafCount(0);
      expect(leafCountAfterSecond).to.equal(1);
    });

    it("Should increment commitment count correctly", async function () {
      await zwToken
        .connect(alice)
        .transfer(bob.address, ethers.parseEther("30"));
      expect(await zwToken.getCommitLeafCount(0)).to.equal(1);

      await zwToken
        .connect(alice)
        .transfer(charlie.address, ethers.parseEther("30"));
      expect(await zwToken.getCommitLeafCount(0)).to.equal(2);

      // Second transfer to Bob should not increase count
      await zwToken
        .connect(alice)
        .transfer(bob.address, ethers.parseEther("10"));
      expect(await zwToken.getCommitLeafCount(0)).to.equal(2);
    });

    it("Should mark recipient as having first receipt recorded", async function () {
      await zwToken
        .connect(alice)
        .transfer(bob.address, ethers.parseEther("50"));

      const hasRecorded = await zwToken.hasFirstReceiptRecorded(bob.address);
      expect(hasRecorded).to.be.true;
    });
  });

  describe("TransferFrom - Should record commitment on first receipt", function () {
    beforeEach(async function () {
      // Alice deposits and approves Bob
      await underlying
        .connect(alice)
        .approve(await zwToken.getAddress(), ethers.parseEther("100"));
      await zwToken
        .connect(alice)
        .depositTo(alice.address, 0, ethers.parseEther("100"));
      await zwToken
        .connect(alice)
        .approve(bob.address, ethers.parseEther("100"));
    });

    it("Should create commitment when Bob transfers to Charlie", async function () {
      await zwToken
        .connect(bob)
        .transferFrom(alice.address, charlie.address, ethers.parseEther("50"));

      // Check commitment was created
      const leafCount = await zwToken.getCommitLeafCount(0);
      expect(leafCount).to.equal(1);

      // Verify the commitment data
      const [commitHashes, recipients, amounts] = await zwToken.getCommitLeaves(0, 0, 1);
      expect(recipients[0]).to.equal(charlie.address);
      expect(amounts[0]).to.equal(ethers.parseEther("50"));
    });

    it("Should NOT create new commitment on second transferFrom to same recipient", async function () {
      await zwToken
        .connect(bob)
        .transferFrom(alice.address, charlie.address, ethers.parseEther("30"));

      const leafCountAfterFirst = await zwToken.getCommitLeafCount(0);
      expect(leafCountAfterFirst).to.equal(1);

      await zwToken
        .connect(bob)
        .transferFrom(alice.address, charlie.address, ethers.parseEther("20"));

      // Should still have only 1 commitment
      const leafCountAfterSecond = await zwToken.getCommitLeafCount(0);
      expect(leafCountAfterSecond).to.equal(1);
    });
  });

  describe("Claim - Should record commitment on first receipt", function () {
    beforeEach(async function () {
      // Setup: Alice deposits and transfers to a privacy address
      await underlying
        .connect(alice)
        .approve(await zwToken.getAddress(), ethers.parseEther("100"));
      await zwToken
        .connect(alice)
        .depositTo(alice.address, 0, ethers.parseEther("100"));

      // Generate privacy address
      const secret = 12345n;
      const addrScalar = poseidon([secret]);
      const addr20 = addrScalar & ((1n << 160n) - 1n);
      const privacyAddr = "0x" + addr20.toString(16).padStart(40, "0");

      // Transfer to privacy address (this creates a commitment)
      await zwToken
        .connect(alice)
        .transfer(privacyAddr, ethers.parseEther("50"));

      // Now we have 1 commitment for privacyAddr
    });

    it("Should create commitment when claiming to Bob (first receipt)", async function () {
      // Mock verifier to return true
      await verifier.setResult(true);

      const amount = ethers.parseEther("30");
      const root = await zwToken.root(); // Use actual root from tree
      const nullifier = ethers.id("test-nullifier-1");

      const proofBytes = encodeProof(
        [0, 0],
        [
          [0, 0],
          [0, 0],
        ],
        [0, 0]
      );
      await zwToken.remint(
        proofBytes,
        root,
        nullifier,
        bob.address,
        0, // id
        amount,
        false, // withdrawUnderlying
        0 // relayerFee
      );

      // Check commitment was created
      const leafCount = await zwToken.getCommitLeafCount(0);
      expect(leafCount).to.equal(2); // 1 from privacy address transfer + 1 from claim

      // Verify the latest commitment data
      const [commitHashes, recipients, amounts] = await zwToken.getCommitLeaves(0, 1, 1);
      expect(recipients[0]).to.equal(bob.address);
      expect(amounts[0]).to.equal(amount);
    });

    it("Should NOT create new commitment when claiming to previously received address", async function () {
      await verifier.setResult(true);

      // First, Alice transfers to Bob (creates commitment for Bob)
      await zwToken
        .connect(alice)
        .transfer(bob.address, ethers.parseEther("10"));

      const leafCountAfterTransfer = await zwToken.getCommitLeafCount(0);
      expect(leafCountAfterTransfer).to.equal(2); // 1 from privacy address + 1 from Bob transfer

      // Now claim to Bob (should not create new commitment)
      const amount = ethers.parseEther("30");
      const root = await zwToken.root(); // Use actual root from tree
      const nullifier = ethers.id("test-nullifier-2");

      const proofBytes2 = encodeProof(
        [0, 0],
        [
          [0, 0],
          [0, 0],
        ],
        [0, 0]
      );
      await zwToken.remint(
        proofBytes2,
        root,
        nullifier,
        bob.address,
        0, // id
        amount,
        false, // withdrawUnderlying
        0 // relayerFee
      );

      // Should still have only 2 commitments (no new one created)
      const leafCountAfterClaim = await zwToken.getCommitLeafCount(0);
      expect(leafCountAfterClaim).to.equal(2);
    });

    it("Should mint ZWERC20 to recipient on claim", async function () {
      await verifier.setResult(true);

      const amount = ethers.parseEther("30");
      const root = await zwToken.root(); // Use actual root from tree
      const nullifier = ethers.id("test-nullifier-3");

      const bobBalanceBefore = await zwToken.balanceOf(bob.address);

      const proofBytes3 = encodeProof(
        [0, 0],
        [
          [0, 0],
          [0, 0],
        ],
        [0, 0]
      );
      await zwToken.remint(
        proofBytes3,
        root,
        nullifier,
        bob.address,
        0, // id
        amount,
        false, // withdrawUnderlying
        0 // relayerFee
      );

      const bobBalanceAfter = await zwToken.balanceOf(bob.address);
      expect(bobBalanceAfter - bobBalanceBefore).to.equal(amount);
    });
  });

  describe("Merkle Tree Integration", function () {
    beforeEach(async function () {
      await underlying
        .connect(alice)
        .approve(await zwToken.getAddress(), ethers.parseEther("200"));
      await zwToken
        .connect(alice)
        .depositTo(alice.address, 0, ethers.parseEther("200"));
    });

    it("Should build correct Merkle tree with multiple transfers", async function () {
      // Transfer to 3 different addresses
      await zwToken
        .connect(alice)
        .transfer(bob.address, ethers.parseEther("50"));
      await zwToken
        .connect(alice)
        .transfer(charlie.address, ethers.parseEther("60"));
      await zwToken
        .connect(alice)
        .transfer(owner.address, ethers.parseEther("70"));

      // Should have 3 commitments
      expect(await zwToken.getCommitLeafCount(0)).to.equal(3);

      // Check root is updated
      const root = await zwToken.root();
      expect(root).to.not.equal(ethers.ZeroHash);

      // Check root is in history
      const isKnown = await zwToken.isKnownRoot(root);
      expect(isKnown).to.be.true;
    });

    it("Should maintain commitment order in tree", async function () {
      const amount1 = ethers.parseEther("50");
      const amount2 = ethers.parseEther("60");

      await zwToken.connect(alice).transfer(bob.address, amount1);
      await zwToken.connect(alice).transfer(charlie.address, amount2);

      // Verify commitment count
      const count = await zwToken.getCommitLeafCount(0);
      expect(count).to.equal(2);

      // Verify commitments are stored in correct order
      const [commitHashes, recipients, amounts] = await zwToken.getCommitLeaves(0, 0, 2);

      // First commitment (Bob)
      expect(recipients[0]).to.equal(bob.address);
      expect(amounts[0]).to.equal(amount1);

      // Second commitment (Charlie)
      expect(recipients[1]).to.equal(charlie.address);
      expect(amounts[1]).to.equal(amount2);
    });
  });
});

// ========== Mock Contracts ==========

// Add these contracts to your test setup or create separate files

// MockVerifier.sol
/*
pragma solidity ^0.8.20;

contract MockVerifier {
    bool public result = true;
    
    function setResult(bool _result) external {
        result = _result;
    }
    
    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[4] calldata
    ) external view returns (bool) {
        return result;
    }
}
*/

// ERC20Mock.sol
/*
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Mock is ERC20 {
    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply
    ) ERC20(name, symbol) {
        _mint(msg.sender, initialSupply);
    }
}
*/
