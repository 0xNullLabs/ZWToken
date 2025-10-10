/* submit_claim.js - submit claim using snarkjs-style proof
   Usage:
   node client/submit_claim.js \
     --rpc <RPC> \
     --pk <hexPrivKey> \
     --contract <tokenAddress> \
     --proof <path/to/proof.json> \
     --inputs <path/to/inputs.json>
*/

const { ethers } = require("ethers");
const fs = require("fs");

const ABI = [
  "function claim(uint256[2] a, uint256[2][2] b, uint256[2] c, bytes32 headerHash, uint256 blockNumber, bytes32 stateRoot, uint256 amount, bytes32 nullifier, address to)",
];

function hexToBytes32(hex) {
  return ethers.zeroPadValue(hex, 32);
}

async function main() {
  const argv = require("minimist")(process.argv.slice(2));
  const rpc = argv.rpc;
  const pk = argv.pk;
  const contractAddr = ethers.getAddress(argv.contract);
  const proofPath = argv.proof;
  const inputsPath = argv.inputs;
  if (!rpc || !pk || !contractAddr || !proofPath || !inputsPath) {
    console.error("missing args");
    process.exit(1);
  }
  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(pk, provider);
  const contract = new ethers.Contract(contractAddr, ABI, wallet);

  const proof = JSON.parse(fs.readFileSync(proofPath, "utf8")); // {proof:{a,b,c}, publicSignals?:[]}
  const inputs = JSON.parse(fs.readFileSync(inputsPath, "utf8")); // from build_inputs
  const pub = inputs.public;

  const a = [proof.proof.a[0], proof.proof.a[1]].map(ethers.toBeHex);
  const b = [
    [proof.proof.b[0][0], proof.proof.b[0][1]].map(ethers.toBeHex),
    [proof.proof.b[1][0], proof.proof.b[1][1]].map(ethers.toBeHex),
  ];
  const c = [proof.proof.c[0], proof.proof.c[1]].map(ethers.toBeHex);

  const tx = await contract.claim(
    a,
    b,
    c,
    pub.headerHash,
    pub.blockNumber,
    pub.stateRoot,
    pub.amount,
    pub.nullifier,
    pub.to,
    { gasLimit: 1_500_000 }
  );
  console.log("tx:", tx.hash);
  const rcpt = await tx.wait();
  console.log("confirmed in block", rcpt.blockNumber);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
