// SPDX-License-Identifier: CC0-1.0

pragma solidity ^0.8.0;

interface IMintableERC20 {
    function mint(address to, uint256 amount) external;
}
