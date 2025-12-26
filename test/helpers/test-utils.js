const { ethers } = require("hardhat");
const { poseidon } = require("circomlibjs");
const snarkjs = require("snarkjs");
const path = require("path");

// Path configuration
const projectRoot = path.join(__dirname, "../..");
const wasmPath = path.join(projectRoot, "circuits/out/remint_js/remint.wasm");
const zkeyPath = path.join(projectRoot, "circuits/out/remint_final.zkey");

/**
 * Helper: Encode Groth16 proof as bytes
 */
function encodeProof(a, b, c) {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  return abiCoder.encode(
    ["uint256[2]", "uint256[2][2]", "uint256[2]"],
    [a, b, c]
  );
}

/**
 * Helper: Encode relayerFee as relayerData bytes
 */
function encodeRelayerData(relayerFee) {
  if (relayerFee === 0 || relayerFee === 0n) {
    return "0x"; // Empty bytes
  }
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  return abiCoder.encode(["uint256"], [relayerFee]);
}

/**
 * Helper: Create ZWConfig struct for deployment
 */
function createZWConfig(verifierAddress, feeCollectorAddress, fees = {}) {
  return {
    verifier: verifierAddress,
    feeCollector: feeCollectorAddress,
    feeDenominator: fees.feeDenominator || 10000,
    depositFee: fees.depositFee || 0,
    remintFee: fees.remintFee || 0,
    withdrawFee: fees.withdrawFee || 0,
    minDepositFee: fees.minDepositFee || 0,
    minWithdrawFee: fees.minWithdrawFee || 0,
    minRemintFee: fees.minRemintFee || 0,
  };
}

/**
 * Helper: Derive privacy address from secret and tokenId
 */
function derivePrivacyAddress(tokenId, secret) {
  const addrScalar = poseidon([8065n, tokenId, secret]);
  const addr20 = addrScalar & ((1n << 160n) - 1n);
  const q = (addrScalar - addr20) / (1n << 160n);
  const privacyAddress = ethers.getAddress(
    "0x" + addr20.toString(16).padStart(40, "0")
  );
  return { addrScalar, addr20, q, privacyAddress };
}

/**
 * Helper: Calculate nullifier
 */
function calculateNullifier(addr20, secret) {
  const nullifier = poseidon([addr20, secret]);
  const nullifierHex = "0x" + nullifier.toString(16).padStart(64, "0");
  return { nullifier, nullifierHex };
}

/**
 * Helper: Generate ZK proof
 */
async function generateZKProof(circuitInput) {
  const { proof: zkProof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInput,
    wasmPath,
    zkeyPath
  );

  const calldata = await snarkjs.groth16.exportSolidityCallData(
    zkProof,
    publicSignals
  );
  const calldataJson = JSON.parse("[" + calldata + "]");
  const proofBytes = encodeProof(
    calldataJson[0],
    calldataJson[1],
    calldataJson[2]
  );

  return { zkProof, publicSignals, proofBytes };
}

/**
 * Helper: Deploy PoseidonT3 library
 */
async function deployPoseidonT3() {
  const PoseidonT3 = await ethers.getContractFactory(
    "poseidon-solidity/PoseidonT3.sol:PoseidonT3"
  );
  const poseidonT3 = await PoseidonT3.deploy();
  await poseidonT3.waitForDeployment();
  return poseidonT3;
}

/**
 * Helper: Deploy Groth16Verifier
 */
async function deployVerifier() {
  const Groth16Verifier = await ethers.getContractFactory("Groth16Verifier");
  const verifier = await Groth16Verifier.deploy();
  await verifier.waitForDeployment();
  return verifier;
}

module.exports = {
  wasmPath,
  zkeyPath,
  encodeProof,
  encodeRelayerData,
  createZWConfig,
  derivePrivacyAddress,
  calculateNullifier,
  generateZKProof,
  deployPoseidonT3,
  deployVerifier,
  poseidon,
};
