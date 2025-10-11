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
        uint[8] calldata input
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
        bytes32 headerHash,
        uint256 blockNumber,
        bytes32 stateRoot,
        uint256 amount,
        bytes32 nullifier,
        address to
    ) external {
        require(block.number > blockNumber, "past block only");
        require(block.number - blockNumber <= freshnessK, "too old");
        require(blockhash(blockNumber) == headerHash, "header mismatch");
        require(!usedNullifier[nullifier], "nullifier used");

        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        address self = address(this);

        // input signals must match circuit order:
        // [headerHash, blockNumber, stateRoot, amount, nullifier, chainId, contractAddr=self, to]
        uint[8] memory input = [
            uint256(headerHash),
            blockNumber,
            uint256(stateRoot),
            amount,
            uint256(nullifier),
            chainId,
            uint256(uint160(self)),
            uint256(uint160(to))
        ];

        require(verifier.verifyProof(a, b, c, input), "bad proof");

        usedNullifier[nullifier] = true;
        _mint(to, amount);
        emit Claimed(nullifier, to, amount);
    }
}
