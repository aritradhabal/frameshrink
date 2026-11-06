// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;
/// Owned reduction fixture. ABI decoding remains valid after removing values.
contract PayloadSink {
    function consume(uint256[] calldata values) external pure returns (uint256 total) {
        for (uint256 i; i < values.length; ++i) total += values[i];
    }
}
