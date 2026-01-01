import { network } from "hardhat";

async function main() {
  const { ethers } = await network.connect(); // <-- v3 way

  const WaterAllocation = await ethers.getContractFactory("WaterAllocation");
  const contract = await WaterAllocation.deploy();
  await contract.waitForDeployment();

  console.log("✅ Deployed to:", await contract.getAddress());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
