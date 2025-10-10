/*
  build_circuit_input.js - transform high-level inputs into circuit input
  Usage: node client/build_circuit_input.js --in inputs.json --out circuit_input.json
*/

const fs = require("fs");

function hexToBigInt(hex) {
  return BigInt(hex);
}
function addrToBigInt(addr) {
  return BigInt(addr);
}

function main() {
  const argv = require("minimist")(process.argv.slice(2));
  const inPath = argv.in;
  const outPath = argv.out || "circuit_input.json";
  if (!inPath) {
    console.error("missing --in");
    process.exit(1);
  }

  const all = JSON.parse(fs.readFileSync(inPath, "utf8"));
  const pub = all.public;
  const priv = all.private;

  // Convert hex strings to decimal strings for circom inputs
  const input = {
    headerHash: BigInt(pub.headerHash).toString(),
    blockNumber: BigInt(pub.blockNumber).toString(),
    stateRoot: BigInt(pub.stateRoot).toString(),
    amount: BigInt(pub.amount).toString(),
    nullifier: BigInt(pub.nullifier).toString(),
    chainId: BigInt(pub.chainId).toString(),
    contractAddr: BigInt(pub.contractAddr).toString(),
    to: BigInt(pub.to).toString(),

    secret: BigInt(priv.secret).toString(),

    // placeholders mapped to public for now; real circuit will derive them
    headerHashCalc: BigInt(pub.headerHash).toString(),
    numberParsed: BigInt(pub.blockNumber).toString(),
    stateRootParsed: BigInt(pub.stateRoot).toString(),
    storageRootWitness: "0",
    balance: BigInt(pub.amount).toString(),
  };

  fs.writeFileSync(outPath, JSON.stringify(input, null, 2));
  console.error(`[ok] wrote ${outPath}`);
  process.stdout.write(JSON.stringify(input));
}

main();
