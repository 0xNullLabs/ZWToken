// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// NOTE: For compilation, add OpenZeppelin via dependencies in your hardhat project.
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface ISnarkVerifier {
    function verifyProof(
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        uint[7] calldata input
    ) external view returns (bool);
}

contract ZWToken is ERC20 {
    using SafeERC20 for IERC20;

    IERC20 public immutable underlying; // 底层原始 ERC20 代币
    ISnarkVerifier public immutable verifier;
    uint256 public immutable freshnessK; // e.g., 10 blocks

    mapping(bytes32 => bool) public usedNullifier;

    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event Claimed(bytes32 indexed nullifier, address indexed to, uint256 amount);

    constructor(
        string memory name_,
        string memory symbol_,
        address underlying_,
        address verifier_,
        uint256 k_
    ) ERC20(name_, symbol_) {
        require(underlying_ != address(0), "invalid underlying");
        underlying = IERC20(underlying_);
        verifier = ISnarkVerifier(verifier_);
        freshnessK = k_;
    }

    /**
     * @notice 存入底层代币，获得等量的 wrapped 代币
     * @param amount 存入数量
     */
    function deposit(uint256 amount) external {
        require(amount > 0, "amount must > 0");
        underlying.safeTransferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, amount);
        emit Deposited(msg.sender, amount);
    }

    /**
     * @notice 取回底层代币，销毁 wrapped 代币
     * @param amount 取回数量
     */
    function withdraw(uint256 amount) external {
        require(amount > 0, "amount must > 0");
        _burn(msg.sender, amount);
        underlying.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function claim(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256 blockNumber,
        uint256 amount,
        bytes32 nullifier,
        address to
    ) external {
        require(block.number > blockNumber, "past block only");
        require(block.number - blockNumber <= freshnessK, "too old");
        
        // Get headerHash from blockhash - no need to pass it as parameter
        bytes32 headerHash = blockhash(blockNumber);
        require(headerHash != bytes32(0), "block hash unavailable");
        
        require(!usedNullifier[nullifier], "nullifier used");

        uint256 chainId;
        assembly {
            chainId := chainid()
        }

        // input signals must match circuit order:
        // [headerHashHi, headerHashLo, amount, nullifier, chainId, contractAddr, to]
        // Split 256-bit headerHash into high/low 128-bit parts to fit in BN254 field
        uint[7] memory input;
        input[0] = uint256(headerHash) >> 128;           // headerHashHi
        input[1] = uint256(headerHash) & ((1 << 128) - 1); // headerHashLo
        input[2] = amount;
        input[3] = uint256(nullifier);
        input[4] = chainId;
        input[5] = uint256(uint160(address(this)));
        input[6] = uint256(uint160(to));

        require(verifier.verifyProof(a, b, c, input), "bad proof");

        usedNullifier[nullifier] = true;
        _mint(to, amount);
        emit Claimed(nullifier, to, amount);
    }
}
