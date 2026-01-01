"use strict";

const { Contract } = require("fabric-contract-api");

class WaterAllocationContract extends Contract {

  async initLedger(ctx) {
    console.info("Ledger initialized");
  }

  // Base allocation approval
  async createWaterAllocation(ctx, id, farmerID, allocatedVolume, timestamp) {
    const exists = await this.allocationExists(ctx, id);
    if (exists) {
      throw new Error(`Allocation ${id} already exists`);
    }

    const allocation = {
      ID: id,
      farmerID,
      allocatedVolume: Number(allocatedVolume),
      usedVolume: 0,
      timestamp: Number(timestamp),
      additionalVolume: 0,
      issuingAuthority: ctx.clientIdentity.getID(),
    };

    await ctx.stub.putState(id, Buffer.from(JSON.stringify(allocation)));
    return JSON.stringify(allocation);
  }

  // Additional allocation approval
  async addAdditionalAllocation(ctx, baseId, additionalVolume, timestamp) {
    const allocationJSON = await ctx.stub.getState(baseId);
    if (!allocationJSON || allocationJSON.length === 0) {
      throw new Error(`Base allocation ${baseId} does not exist`);
    }

    const allocation = JSON.parse(allocationJSON.toString());
    allocation.additionalVolume =
      (allocation.additionalVolume || 0) + Number(additionalVolume);

    allocation.lastAdditionalTimestamp = Number(timestamp);

    await ctx.stub.putState(baseId, Buffer.from(JSON.stringify(allocation)));
    return JSON.stringify(allocation);
  }

  // Query allocation
  async queryAllocation(ctx, id) {
    const allocationJSON = await ctx.stub.getState(id);
    if (!allocationJSON || allocationJSON.length === 0) {
      throw new Error(`Allocation ${id} does not exist`);
    }
    return allocationJSON.toString();
  }

  // Helper: total allocated volume
  async getTotalAllocatedVolume(ctx, id) {
    const allocationJSON = await ctx.stub.getState(id);
    if (!allocationJSON || allocationJSON.length === 0) {
      throw new Error(`Allocation ${id} does not exist`);
    }

    const allocation = JSON.parse(allocationJSON.toString());
    const total =
      Number(allocation.allocatedVolume) +
      Number(allocation.additionalVolume || 0);

    return total.toString();
  }

  async allocationExists(ctx, id) {
    const data = await ctx.stub.getState(id);
    return data && data.length > 0;
  }
}

module.exports = WaterAllocationContract;
