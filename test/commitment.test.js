const { expect } = require("chai");
const { ethers } = require("hardhat");
const { poseidon } = require("circomlibjs");

describe("ZWToken - Commitment Recording", function () {
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

    // Deploy ZWToken with linked library
    const ZWToken = await ethers.getContractFactory("ZWToken", {
      libraries: {
        PoseidonT3: await poseidonT3.getAddress(),
      },
    });
    zwToken = await ZWToken.deploy(
      "ZK Wrapper Token",
      "ZWT",
      await underlying.getAddress(),
      await verifier.getAddress()
    );

    // Distribute underlying tokens
    await underlying.transfer(alice.address, ethers.parseEther("1000"));
    await underlying.transfer(bob.address, ethers.parseEther("1000"));
  });

  describe("Deposit - Should NOT record commitment", function () {
    it("Should not emit CommitmentAdded on deposit", async function () {
      await underlying
        .connect(alice)
        .approve(await zwToken.getAddress(), ethers.parseEther("100"));

      await expect(
        zwToken.connect(alice).deposit(ethers.parseEther("100"))
      ).to.not.emit(zwToken, "CommitmentAdded");
    });

    it("Should not mark as first receipt recorded after deposit", async function () {
      await underlying
        .connect(alice)
        .approve(await zwToken.getAddress(), ethers.parseEther("100"));
      await zwToken.connect(alice).deposit(ethers.parseEther("100"));

      const hasRecorded = await zwToken.hasFirstReceiptRecorded(alice.address);
      expect(hasRecorded).to.be.false;
    });

    it("Should have 0 commitments after deposits", async function () {
      await underlying
        .connect(alice)
        .approve(await zwToken.getAddress(), ethers.parseEther("100"));
      await zwToken.connect(alice).deposit(ethers.parseEther("100"));

      await underlying
        .connect(bob)
        .approve(await zwToken.getAddress(), ethers.parseEther("100"));
      await zwToken.connect(bob).deposit(ethers.parseEther("100"));

      const count = await zwToken.getCommitmentCount();
      expect(count).to.equal(0);
    });
  });

  describe("Transfer - Should record commitment on first receipt", function () {
    beforeEach(async function () {
      // Alice deposits
      await underlying
        .connect(alice)
        .approve(await zwToken.getAddress(), ethers.parseEther("100"));
      await zwToken.connect(alice).deposit(ethers.parseEther("100"));
    });

    it("Should emit CommitmentAdded on first transfer to Bob", async function () {
      const amount = ethers.parseEther("50");

      await expect(
        zwToken.connect(alice).transfer(bob.address, amount)
      ).to.emit(zwToken, "CommitmentAdded");
    });

    it("Should record correct commitment value", async function () {
      const amount = ethers.parseEther("50");

      // Calculate expected commitment
      const bobAddr = BigInt(bob.address);
      const amountBN = BigInt(amount);
      const expectedCommitment = poseidon([bobAddr, amountBN]);

      const tx = await zwToken.connect(alice).transfer(bob.address, amount);
      const receipt = await tx.wait();

      const event = receipt.logs.find(
        (log) => log.fragment && log.fragment.name === "CommitmentAdded"
      );

      expect(event).to.not.be.undefined;

      const actualCommitment = event.args.commitment;
      const expectedHex =
        "0x" + expectedCommitment.toString(16).padStart(64, "0");

      expect(actualCommitment).to.equal(expectedHex);
    });

    it("Should NOT emit CommitmentAdded on second transfer to same recipient", async function () {
      // First transfer
      await zwToken
        .connect(alice)
        .transfer(bob.address, ethers.parseEther("50"));

      // Second transfer
      await expect(
        zwToken.connect(alice).transfer(bob.address, ethers.parseEther("20"))
      ).to.not.emit(zwToken, "CommitmentAdded");
    });

    it("Should increment commitment count correctly", async function () {
      await zwToken
        .connect(alice)
        .transfer(bob.address, ethers.parseEther("30"));
      expect(await zwToken.getCommitmentCount()).to.equal(1);

      await zwToken
        .connect(alice)
        .transfer(charlie.address, ethers.parseEther("30"));
      expect(await zwToken.getCommitmentCount()).to.equal(2);

      // Second transfer to Bob should not increase count
      await zwToken
        .connect(alice)
        .transfer(bob.address, ethers.parseEther("10"));
      expect(await zwToken.getCommitmentCount()).to.equal(2);
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
      await zwToken.connect(alice).deposit(ethers.parseEther("100"));
      await zwToken
        .connect(alice)
        .approve(bob.address, ethers.parseEther("100"));
    });

    it("Should emit CommitmentAdded when Bob transfers to Charlie", async function () {
      await expect(
        zwToken
          .connect(bob)
          .transferFrom(alice.address, charlie.address, ethers.parseEther("50"))
      ).to.emit(zwToken, "CommitmentAdded");
    });

    it("Should NOT emit CommitmentAdded on second transferFrom to same recipient", async function () {
      await zwToken
        .connect(bob)
        .transferFrom(alice.address, charlie.address, ethers.parseEther("30"));

      await expect(
        zwToken
          .connect(bob)
          .transferFrom(alice.address, charlie.address, ethers.parseEther("20"))
      ).to.not.emit(zwToken, "CommitmentAdded");
    });
  });

  describe("Claim - Should record commitment on first receipt", function () {
    beforeEach(async function () {
      // Setup: Alice deposits and transfers to a privacy address
      await underlying
        .connect(alice)
        .approve(await zwToken.getAddress(), ethers.parseEther("100"));
      await zwToken.connect(alice).deposit(ethers.parseEther("100"));

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

    it("Should emit CommitmentAdded when claiming to Bob (first receipt)", async function () {
      // Mock verifier to return true
      await verifier.setResult(true);

      const amount = ethers.parseEther("30");
      const root = await zwToken.root(); // Use actual root from tree
      const nullifier = ethers.id("test-nullifier-1");

      await expect(
        zwToken.claim(
          [0, 0],
          [
            [0, 0],
            [0, 0],
          ],
          [0, 0],
          root,
          nullifier,
          bob.address,
          amount
        )
      ).to.emit(zwToken, "CommitmentAdded");
    });

    it("Should NOT emit CommitmentAdded when claiming to previously received address", async function () {
      await verifier.setResult(true);

      // First, Alice transfers to Bob (creates commitment for Bob)
      await zwToken
        .connect(alice)
        .transfer(bob.address, ethers.parseEther("10"));

      // Now claim to Bob (should not create new commitment)
      const amount = ethers.parseEther("30");
      const root = await zwToken.root(); // Use actual root from tree
      const nullifier = ethers.id("test-nullifier-2");

      await expect(
        zwToken.claim(
          [0, 0],
          [
            [0, 0],
            [0, 0],
          ],
          [0, 0],
          root,
          nullifier,
          bob.address,
          amount
        )
      ).to.not.emit(zwToken, "CommitmentAdded");
    });

    it("Should mint ZWToken to recipient on claim", async function () {
      await verifier.setResult(true);

      const amount = ethers.parseEther("30");
      const root = await zwToken.root(); // Use actual root from tree
      const nullifier = ethers.id("test-nullifier-3");

      const bobBalanceBefore = await zwToken.balanceOf(bob.address);

      await zwToken.claim(
        [0, 0],
        [
          [0, 0],
          [0, 0],
        ],
        [0, 0],
        root,
        nullifier,
        bob.address,
        amount
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
      await zwToken.connect(alice).deposit(ethers.parseEther("200"));
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
      expect(await zwToken.getCommitmentCount()).to.equal(3);

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

      const tx1 = await zwToken.connect(alice).transfer(bob.address, amount1);
      const receipt1 = await tx1.wait();

      const tx2 = await zwToken
        .connect(alice)
        .transfer(charlie.address, amount2);
      const receipt2 = await tx2.wait();

      // Verify commitment count
      const count = await zwToken.getCommitmentCount();
      expect(count).to.equal(2);

      // Verify first commitment from event
      const event1 = receipt1.logs.find(
        (log) => log.fragment && log.fragment.name === "CommitmentAdded"
      );
      const bobCommitment = poseidon([BigInt(bob.address), BigInt(amount1)]);
      expect(event1.args[0]).to.equal(
        "0x" + bobCommitment.toString(16).padStart(64, "0")
      );
      expect(event1.args[1]).to.equal(0n); // index 0

      // Verify second commitment from event
      const event2 = receipt2.logs.find(
        (log) => log.fragment && log.fragment.name === "CommitmentAdded"
      );
      const charlieCommitment = poseidon([
        BigInt(charlie.address),
        BigInt(amount2),
      ]);
      expect(event2.args[0]).to.equal(
        "0x" + charlieCommitment.toString(16).padStart(64, "0")
      );
      expect(event2.args[1]).to.equal(1n); // index 1
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
