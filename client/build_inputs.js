/*
  build_inputs.js - build prover inputs without exposing derived address
  Usage: node client/build_inputs.js --rpc <RPC> --token <addr> --secret <hex32> --magic <hex32> --to <addr> --k <blocks> [--out inputs.json] [--public-out public.json]
*/

const { ethers } = require("ethers");
const rlp = require("rlp");
const circomlibjs = require("circomlibjs");
const fs = require("fs");

function hexToBigInt(hex) {
  return BigInt(hex);
}

function pad32(hex) {
  return ethers.zeroPadValue(hex, 32);
}

function toHex(bi) {
  return "0x" + bi.toString(16);
}

async function main() {
  const argv = require("minimist")(process.argv.slice(2));
  const rpc = argv.rpc;
  const token = ethers.getAddress(argv.token);
  const secretHex = argv.secret; // 0x...
  const magicHex = argv.magic; // 0x...
  const to = ethers.getAddress(argv.to);
  const K = Number(argv.k ?? 10);
  const outPath = argv.out;
  const pubOutPath = argv["public-out"]; // optional separate public.json
  if (!rpc || !token || !secretHex || !magicHex || !to) {
    console.error("missing args");
    process.exit(1);
  }
  const provider = new ethers.JsonRpcProvider(rpc);
  const chainId = (await provider.getNetwork()).chainId;

  // pick block B = head-2
  const head = await provider.getBlockNumber();
  const B = head - 2;

  // Poseidon(magic, secret)
  const poseidon = await circomlibjs.buildPoseidon();
  const secret = hexToBigInt(secretHex);
  const magic = hexToBigInt(magicHex);
  const addrScalar = poseidon.F.toObject(poseidon([magic, secret]));
  // low 160 bits
  const addr20Bi = addrScalar & ((1n << 160n) - 1n);
  const addr20Hex = toHex(addr20Bi);

  // slotKey = keccak(pad32(addr20) || pad32(0))
  const addr32 = pad32(addr20Hex);
  const slot0 = pad32("0x0");
  const slotKey = ethers.keccak256(ethers.concat([addr32, slot0]));

  // eth_getProof
  const proof = await provider.send("eth_getProof", [
    token,
    [slotKey],
    ethers.toBeHex(B),
  ]);
  const block = await provider.getBlock(B);
  const headerRlp = rlp.encode([
    block.parentHash,
    block.sha3Uncles,
    block.miner,
    block.stateRoot,
    block.transactionsRoot,
    block.receiptsRoot,
    block.logsBloom,
    block.difficulty,
    ethers.toBeHex(block.number),
    block.gasLimit,
    block.gasUsed,
    block.timestamp,
    block.extraData,
    block.mixHash ?? block.prevRandao,
    block.nonce ?? "0x0000000000000000",
  ]);
  const headerHash = ethers.keccak256(headerRlp);

  // public inputs
  const nullifier = toHex(
    poseidon.F.toObject(poseidon([secret, BigInt(chainId), BigInt(token)]))
  );
  const amount = proof.storageProof[0].value; // hex
  const stateRoot = block.stateRoot;

  const pub = {
    headerHash,
    blockNumber: B,
    stateRoot,
    amount,
    nullifier,
    chainId: Number(chainId),
    contractAddr: token,
    to,
  };

  // private inputs (avoid persisting sensitive fields if not necessary)
  const priv = {
    secret: secretHex,
    headerRlp: ethers.hexlify(headerRlp),
    accountProof: proof.accountProof,
    storageProof: {
      key: slotKey,
      proof: proof.storageProof[0].proof,
      value: amount,
    },
  };

  const all = { public: pub, private: priv };

  // Write to files when requested
  if (outPath) {
    fs.writeFileSync(outPath, JSON.stringify(all, null, 2));
    console.error(`[ok] wrote ${outPath}`);
  }
  if (pubOutPath) {
    fs.writeFileSync(pubOutPath, JSON.stringify(pub, null, 2));
    console.error(`[ok] wrote ${pubOutPath}`);
  }

  // Always print to stdout for piping
  console.log(JSON.stringify(all, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
