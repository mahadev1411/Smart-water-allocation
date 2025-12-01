// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract WaterAllocation {
    struct Allocation {
        string ID;
        string farmerID;
        uint256 allocatedVolume;   // base approved volume
        uint256 usedVolume;        // tracked usage (demo)
        uint256 timestamp;         // base approval timestamp
        address issuingAuthority;
        bool exists;
    }

    address public authority; // Water Authority = deployer

    mapping(string => Allocation) private allocations;

    // total additional volume approved for a base allocation id
    mapping(string => uint256) private additionalVolumes;

    event AllocationStored(
        string ID,
        string farmerID,
        uint256 allocatedVolume,
        uint256 usedVolume,
        uint256 timestamp,
        address issuingAuthority
    );

    event AdditionalAllocationStored(
        string baseId,
        uint256 additionalVolume,
        uint256 newTotalVolume,
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

    // Base allocation approval (same as before)
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

    // Additional allocation approval for an existing base allocation
    function addAdditionalAllocation(
        string calldata baseId,
        uint256 additionalVolume,
        uint256 timestamp
    ) external onlyAuthority {
        Allocation storage a = allocations[baseId];
        require(a.exists, "Base allocation does not exist");
        require(additionalVolume > 0, "Additional volume must be > 0");

        additionalVolumes[baseId] += additionalVolume;

        emit AdditionalAllocationStored(
            baseId,
            additionalVolume,
            a.allocatedVolume + additionalVolumes[baseId],
            timestamp,
            msg.sender
        );
    }

    // Query base allocation + total additional approved
    function queryAllocation(string calldata id)
        external
        view
        returns (
            string memory,
            string memory,
            uint256,
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
            additionalVolumes[id],
            a.issuingAuthority
        );
    }

    // Convenience helper (optional): get total approved volume
    function getTotalAllocatedVolume(string calldata id)
        external
        view
        returns (uint256)
    {
        Allocation memory a = allocations[id];
        require(a.exists, "Allocation does not exist");
        return a.allocatedVolume + additionalVolumes[id];
    }
}
