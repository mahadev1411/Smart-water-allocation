import { network } from "hardhat";

async function main() {
  const { ethers } = await network.connect();
  const [authority] = await ethers.getSigners(); // deployer = authority

  const contractAddress = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
  const water = await ethers.getContractAt("WaterAllocation", contractAddress);

  const id = "ALLOC101";
  const farmerID = "FARMER07";
  const allocatedVolume = 6000;
  const timestamp = Math.floor(Date.now() / 1000);

  const tx = await water
    .connect(authority)
    .createWaterAllocation(id, farmerID, allocatedVolume, timestamp);

  const receipt = await tx.wait();

  console.log("✅ Allocation created");
  console.log("Tx hash:", receipt.hash);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
