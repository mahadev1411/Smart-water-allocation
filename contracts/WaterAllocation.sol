// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract WaterAllocation {
    struct Allocation {
        string ID;
        string farmerID;
        uint256 allocatedVolume;
        uint256 usedVolume;
        uint256 timestamp;
        address issuingAuthority;
        bool exists;
    }

    address public authority; // Water Authority = deployer

    mapping(string => Allocation) private allocations;

    event AllocationStored(
        string ID,
        string farmerID,
        uint256 allocatedVolume,
        uint256 usedVolume,
        uint256 timestamp,
        address issuingAuthority
    );

    modifier onlyAuthority() {
        require(msg.sender == authority, "Only Water Authority can create allocations");
        _;
    }

    constructor() {
        authority = msg.sender;
    }

    // Same as old CreateWaterAllocation
    function createWaterAllocation(
        string calldata id,
        string calldata farmerID,
        uint256 allocatedVolume,
        uint256 timestamp
    ) external onlyAuthority {
        require(!allocations[id].exists, "Allocation already exists");
        require(allocatedVolume > 0, "Allocated volume must be > 0");

        allocations[id] = Allocation({
            ID: id,
            farmerID: farmerID,
            allocatedVolume: allocatedVolume,
            usedVolume: 0,
            timestamp: timestamp,
            issuingAuthority: msg.sender,
            exists: true
        });

        emit AllocationStored(
            id,
            farmerID,
            allocatedVolume,
            0,
            timestamp,
            msg.sender
        );
    }

    // Same as old QueryAllocation
    function queryAllocation(string calldata id)
        external
        view
        returns (
            string memory,
            string memory,
            uint256,
            uint256,
            uint256,
            address
        )
    {
        Allocation memory a = allocations[id];
        require(a.exists, "Allocation does not exist");

        return (
            a.ID,
            a.farmerID,
            a.allocatedVolume,
            a.usedVolume,
            a.timestamp,
            a.issuingAuthority
        );
    }
}
