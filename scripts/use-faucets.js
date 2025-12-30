const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

/**
 * Example script to interact with faucet contracts
 *
 * Usage:
 *   npx hardhat run scripts/use-faucets.js --network sepolia
 *
 * Reads faucet addresses from faucet.config.json or environment variables.
 */

function loadFaucetAddresses() {
  // Try to load from config file first
  const configPath = path.join(__dirname, "..", "faucet.config.json");
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const addresses = { erc721: null, erc1155: null };

    for (const faucet of config.faucets || []) {
      if (faucet.type?.toUpperCase() === "ERC721FAUCET" && faucet.address) {
        addresses.erc721 = faucet.address;
      }
      if (faucet.type?.toUpperCase() === "ERC1155FAUCET" && faucet.address) {
        addresses.erc1155 = faucet.address;
      }
    }

    if (addresses.erc721 || addresses.erc1155) {
      return addresses;
    }
  }

  // Fall back to environment variables
  return {
    erc721: process.env.FAUCET_721_ADDRESS || null,
    erc1155: process.env.FAUCET_1155_ADDRESS || null,
  };
}

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Using account:", signer.address);

  const addresses = loadFaucetAddresses();

  if (!addresses.erc721 && !addresses.erc1155) {
    console.error(
      "No faucet addresses found. Deploy faucets first or set environment variables."
    );
    process.exit(1);
  }

  // Interact with ERC721Faucet
  if (addresses.erc721) {
    console.log("\n" + "=".repeat(60));
    console.log("ERC721 Faucet");
    console.log("=".repeat(60));

    const ERC721Faucet = await ethers.getContractFactory("ERC721Faucet");
    const erc721Faucet = ERC721Faucet.attach(addresses.erc721);

    console.log("Address:", addresses.erc721);

    // Get token info
    const name = await erc721Faucet.name();
    const symbol = await erc721Faucet.symbol();
    console.log(`Token: ${name} (${symbol})`);

    // Check current balance
    const balanceBefore = await erc721Faucet.balanceOf(signer.address);
    console.log(`Current balance: ${balanceBefore}`);

    // Mint
    console.log("\nMinting NFT...");
    const tx = await erc721Faucet.faucetMint(signer.address);
    const receipt = await tx.wait();
    console.log(`✅ NFT minted! Transaction: ${receipt.hash}`);

    // Parse the Transfer event to get the token ID
    const iface = erc721Faucet.interface;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed && parsed.name === "Transfer") {
          const tokenId = parsed.args.tokenId;
          console.log(`Token ID: ${tokenId}`);

          // Verify ownership
          const owner = await erc721Faucet.ownerOf(tokenId);
          console.log(`Owner of token ${tokenId}: ${owner}`);
        }
      } catch (e) {
        // Ignore logs that can't be parsed
      }
    }

    // Check new balance
    const balanceAfter = await erc721Faucet.balanceOf(signer.address);
    console.log(`New balance: ${balanceAfter}`);
  }

  // Interact with ERC1155Faucet
  if (addresses.erc1155) {
    console.log("\n" + "=".repeat(60));
    console.log("ERC1155 Faucet");
    console.log("=".repeat(60));

    const ERC1155Faucet = await ethers.getContractFactory("ERC1155Faucet");
    const erc1155Faucet = ERC1155Faucet.attach(addresses.erc1155);

    console.log("Address:", addresses.erc1155);

    // Get token info
    const name = await erc1155Faucet.name();
    const symbol = await erc1155Faucet.symbol();
    console.log(`Token: ${name} (${symbol})`);

    // Check current balance (for first token if exists)
    const balanceBefore = await erc1155Faucet.balanceOf(signer.address, 0);
    console.log(`Current balance of token 0: ${balanceBefore}`);

    // Mint with amount
    const amount = 10;
    console.log(`\nMinting ${amount} tokens...`);
    const tx = await erc1155Faucet.faucetMint(signer.address, amount);
    const receipt = await tx.wait();
    console.log(`✅ Tokens minted! Transaction: ${receipt.hash}`);

    // Parse the TransferSingle event to get the token ID
    const iface = erc1155Faucet.interface;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed && parsed.name === "TransferSingle") {
          const tokenId = parsed.args.id;
          const mintedAmount = parsed.args.value;
          console.log(`Token ID: ${tokenId}`);
          console.log(`Minted amount: ${mintedAmount}`);

          // Check balance
          const balance = await erc1155Faucet.balanceOf(
            signer.address,
            tokenId
          );
          console.log(`Balance of token ${tokenId}: ${balance}`);
        }
      } catch (e) {
        // Ignore logs that can't be parsed
      }
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("✅ Done!");
  console.log("=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
