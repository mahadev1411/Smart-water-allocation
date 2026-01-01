import { network } from "hardhat";

async function main() {
  const { ethers } = await network.connect();
  const [, farmer] = await ethers.getSigners(); 
  // farmer = second account, NOT authority

  const contractAddress = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
  const water = await ethers.getContractAt("WaterAllocation", contractAddress);

  const id = "ALLOC101";

  const allocation = await water.connect(farmer).queryAllocation(id);

  console.log("✅ Allocation fetched by farmer:");
  console.log({
    ID: allocation[0],
    farmerID: allocation[1],
    allocatedVolume: allocation[2].toString(),
    usedVolume: allocation[3].toString(),
    timestamp: allocation[4].toString(),
    issuingAuthority: allocation[5],
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
