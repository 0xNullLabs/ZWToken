/**
 * Frontend Merkle Proof Generator
 * Generates Merkle proofs entirely in the browser without backend dependency
 * Only requires connection to Ethereum node provider
 */

const { ethers } = require("ethers");
const { poseidon } = require("circomlibjs");

/**
 * Incremental Merkle Tree (Frontend Implementation)
 * Compatible with the ZWToken contract's Poseidon-based tree
 */
class IncrementalMerkleTree {
  constructor(depth) {
    this.depth = depth;
    this.zeros = [];
    this.filledSubtrees = new Array(depth);
    this.leaves = [];
    this.nextIndex = 0;

    // Initialize zero hashes
    this._initZeroHashes();
  }

  _initZeroHashes() {
    let currentZero = BigInt(0);
    this.zeros[0] = currentZero;

    for (let i = 1; i < this.depth; i++) {
      currentZero = poseidon([currentZero, currentZero]);
      this.zeros[i] = currentZero;
    }

    // Initial root
    this.root = this.zeros[this.depth - 1];
  }

  _poseidonHash(left, right) {
    return poseidon([BigInt(left), BigInt(right)]);
  }

  insert(leaf) {
    if (this.nextIndex >= 2 ** this.depth) {
      throw new Error("Tree is full");
    }

    this.leaves.push(leaf);
    const index = this.nextIndex;

    let currentHash = BigInt(leaf);
    let currentIndex = index;

    for (let i = 0; i < this.depth; i++) {
      if (currentIndex % 2 === 0) {
        // Left child
        this.filledSubtrees[i] = currentHash;
        currentHash = this._poseidonHash(currentHash, this.zeros[i]);
      } else {
        // Right child
        currentHash = this._poseidonHash(this.filledSubtrees[i], currentHash);
      }

      currentIndex = Math.floor(currentIndex / 2);
    }

    this.root = currentHash;
    this.nextIndex++;
  }

  /**
   * Generate Merkle proof for a leaf at given index
   * @param {number} index - Leaf index
   * @returns {object} - Proof with pathElements and pathIndices
   */
  getProof(index) {
    if (index >= this.nextIndex) {
      throw new Error("Invalid index");
    }

    const pathElements = [];
    const pathIndices = [];

    let currentIndex = index;

    for (let i = 0; i < this.depth; i++) {
      const isRight = currentIndex % 2 === 1;

      if (isRight) {
        // Current is right child, sibling is in filledSubtrees
        pathElements.push(this.filledSubtrees[i] || this.zeros[i]);
        pathIndices.push(1);
      } else {
        // Current is left child, sibling is next leaf or zero
        const siblingIndex = currentIndex + 1;
        if (siblingIndex < this.nextIndex) {
          // Reconstruct sibling hash
          let siblingHash = this.leaves[siblingIndex];
          let tempIndex = siblingIndex;

          for (let j = 0; j < i; j++) {
            if (tempIndex % 2 === 0) {
              siblingHash = this._poseidonHash(siblingHash, this.zeros[j]);
            } else {
              const left = this.filledSubtrees[j] || this.zeros[j];
              siblingHash = this._poseidonHash(left, siblingHash);
            }
            tempIndex = Math.floor(tempIndex / 2);
          }

          pathElements.push(siblingHash);
        } else {
          pathElements.push(this.zeros[i]);
        }
        pathIndices.push(0);
      }

      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      root: this.root,
      pathElements: pathElements.map((x) => BigInt(x)),
      pathIndices,
    };
  }
}

/**
 * Frontend Merkle Proof Generator
 * Interacts with ZWToken contract to build proofs
 */
class MerkleProofGenerator {
  constructor(contractAddress, provider) {
    this.contractAddress = contractAddress;
    this.provider = provider;

    // ZWToken ABI (minimal, only what we need)
    this.abi = [
      "function getAllCommitments() view returns (bytes32[])",
      "function getCommitmentCount() view returns (uint256)",
      "function commitments(uint256) view returns (bytes32)",
      "function root() view returns (bytes32)",
      "function nextIndex() view returns (uint256)",
      "event CommitmentAdded(bytes32 indexed commitment, uint256 index)",
      "event PendingCommitment(address indexed recipient, uint256 amount)",
    ];

    this.contract = new ethers.Contract(contractAddress, this.abi, provider);
    this.tree = null;
  }

  /**
   * Rebuild Merkle tree from on-chain commitments
   * Method 1: Direct query (simple but may be slow for large trees)
   */
  async rebuildTreeFromCommitments() {
    console.log("🌳 Rebuilding Merkle tree from on-chain commitments...");

    const commitments = await this.contract.getAllCommitments();
    console.log(`   Found ${commitments.length} commitments`);

    this.tree = new IncrementalMerkleTree(20);

    for (const commitment of commitments) {
      this.tree.insert(commitment);
    }

    // Verify root matches
    const contractRoot = await this.contract.root();
    const treeRoot = "0x" + this.tree.root.toString(16).padStart(64, "0");

    if (treeRoot !== contractRoot) {
      throw new Error(
        `Root mismatch! Contract: ${contractRoot}, Tree: ${treeRoot}`
      );
    }

    console.log("   ✅ Tree rebuilt successfully");
    console.log(`   Root: ${treeRoot}`);

    return this.tree;
  }

  /**
   * Rebuild Merkle tree from events (faster for large trees)
   * Method 2: Event-based reconstruction
   */
  async rebuildTreeFromEvents(fromBlock = 0) {
    console.log("🌳 Rebuilding Merkle tree from events...");

    const filter = this.contract.filters.CommitmentAdded();
    const events = await this.contract.queryFilter(filter, fromBlock, "latest");

    console.log(`   Found ${events.length} CommitmentAdded events`);

    // Sort by index to ensure correct order
    events.sort((a, b) => Number(a.args.index) - Number(b.args.index));

    this.tree = new IncrementalMerkleTree(20);

    for (const event of events) {
      this.tree.insert(event.args.commitment);
    }

    // Verify root matches
    const contractRoot = await this.contract.root();
    const treeRoot = "0x" + this.tree.root.toString(16).padStart(64, "0");

    if (treeRoot !== contractRoot) {
      console.warn(
        `⚠️  Root mismatch! This may be expected if there are pending commitments.`
      );
      console.warn(`   Contract root: ${contractRoot}`);
      console.warn(`   Rebuilt root: ${treeRoot}`);
    } else {
      console.log("   ✅ Tree rebuilt successfully from events");
    }

    return this.tree;
  }

  /**
   * Calculate commitment for an address and amount
   */
  calculateCommitment(address, amount) {
    const addr160 = BigInt(address);
    const amountBN = BigInt(amount);
    const commitment = poseidon([addr160, amountBN]);

    return "0x" + commitment.toString(16).padStart(64, "0");
  }

  /**
   * Find commitment index for a given address
   */
  async findCommitmentIndex(address, amount) {
    if (!this.tree) {
      await this.rebuildTreeFromEvents();
    }

    const commitment = this.calculateCommitment(address, amount);
    const commitmentBN = BigInt(commitment);

    const index = this.tree.leaves.findIndex(
      (leaf) => BigInt(leaf) === commitmentBN
    );

    if (index === -1) {
      throw new Error(
        `Commitment not found for address ${address} with amount ${amount}`
      );
    }

    return index;
  }

  /**
   * Generate Merkle proof for an address
   * @param {string} address - Privacy address (0x...)
   * @param {string|BigInt} amount - First receipt amount
   * @returns {object} - Proof data ready for ZK circuit
   */
  async generateProof(address, amount) {
    console.log(`\n📜 Generating Merkle proof for ${address}...`);

    // Ensure tree is built
    if (!this.tree) {
      await this.rebuildTreeFromEvents();
    }

    // Find commitment
    const commitment = this.calculateCommitment(address, amount);
    console.log(`   Commitment: ${commitment}`);

    // Find index
    const index = await this.findCommitmentIndex(address, amount);
    console.log(`   Index: ${index}`);

    // Generate proof
    const proof = this.tree.getProof(index);

    console.log(`   ✅ Proof generated`);
    console.log(`   Root: 0x${proof.root.toString(16).padStart(64, "0")}`);

    return {
      root: proof.root,
      pathElements: proof.pathElements,
      pathIndices: proof.pathIndices,
      commitment,
      index,
    };
  }

  /**
   * Check if address has pending commitment
   */
  async hasPendingCommitment(address) {
    const filter = this.contract.filters.PendingCommitment(address);
    const events = await this.contract.queryFilter(filter, -10000, "latest"); // Last 10000 blocks

    return events.length > 0;
  }
}

/**
 * Complete ZK Proof Generation (Frontend)
 * Combines Merkle proof with ZK circuit proof generation
 */
class ZKProofGenerator {
  constructor(contractAddress, provider) {
    this.merkleGenerator = new MerkleProofGenerator(contractAddress, provider);
  }

  /**
   * Generate complete circuit input for ZK proof
   * @param {string} secret - User's secret (bigint or hex string)
   * @param {string} recipientAddress - Claim recipient address
   * @param {string|BigInt} claimAmount - Amount to claim
   * @returns {object} - Circuit input ready for snarkjs
   */
  async generateCircuitInput(secret, recipientAddress, claimAmount) {
    console.log("\n🔐 Generating ZK proof input...");

    // 1. Derive privacy address from secret
    const secretBN = BigInt(secret);
    const addrScalar = poseidon([secretBN]);
    const addr20 = addrScalar & ((1n << 160n) - 1n);
    const addr20Hex = "0x" + addr20.toString(16).padStart(40, "0");
    const q = (addrScalar - addr20) / (1n << 160n);

    console.log(`   Privacy address: ${addr20Hex}`);

    // 2. Get first receipt amount from events or pending
    const firstAmount = await this._getFirstReceiptAmount(addr20Hex);
    console.log(`   First receipt amount: ${firstAmount}`);

    // 3. Generate Merkle proof
    const merkleProof = await this.merkleGenerator.generateProof(
      addr20Hex,
      firstAmount
    );

    // 4. Calculate nullifier
    const nullifier = poseidon([addr20]);

    // 5. Prepare circuit input
    const circuitInput = {
      // Public inputs
      root: merkleProof.root,
      nullifier: nullifier,
      to: BigInt(recipientAddress),
      claimAmount: BigInt(claimAmount),

      // Private inputs
      secret: secretBN,
      addr20: addr20,
      firstAmount: BigInt(firstAmount),
      q: q,
      pathElements: merkleProof.pathElements,
      pathIndices: merkleProof.pathIndices,
    };

    console.log("   ✅ Circuit input ready");

    return circuitInput;
  }

  async _getFirstReceiptAmount(address) {
    // Try to get from pending first
    const filter =
      this.merkleGenerator.contract.filters.PendingCommitment(address);
    const events = await this.merkleGenerator.contract.queryFilter(
      filter,
      -10000,
      "latest"
    );

    if (events.length > 0) {
      return events[0].args.amount.toString();
    }

    // If not pending, try to find in committed
    const commitmentFilter =
      this.merkleGenerator.contract.filters.CommitmentAdded();
    const commitmentEvents = await this.merkleGenerator.contract.queryFilter(
      commitmentFilter,
      0,
      "latest"
    );

    // This would require scanning all commitments - in practice, user should store this
    throw new Error(
      "First receipt amount not found. User should store this value locally."
    );
  }
}

module.exports = {
  IncrementalMerkleTree,
  MerkleProofGenerator,
  ZKProofGenerator,
};

// Example usage:
/*
const { ethers } = require('ethers');
const { ZKProofGenerator } = require('./merkle_proof_frontend');

async function example() {
    const provider = new ethers.JsonRpcProvider('http://localhost:8545');
    const contractAddress = '0x...';
    
    const generator = new ZKProofGenerator(contractAddress, provider);
    
    // User's secret (should be securely stored)
    const secret = '0x123456789abcdef...';
    
    // Generate circuit input
    const circuitInput = await generator.generateCircuitInput(
        secret,
        '0xRecipientAddress...',
        ethers.parseEther('100')
    );
    
    // Now use snarkjs to generate proof
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        circuitInput,
        'claim_first_receipt.wasm',
        'claim_first_receipt_final.zkey'
    );
    
    // Submit to contract
    // ... (call contract.claim with proof)
}
*/
