"use strict";

const fs = require("fs");
const path = require("path");
const grpc = require("@grpc/grpc-js");
const crypto = require("crypto");
const { connect, signers } = require("@hyperledger/fabric-gateway");

/* ---------------- CONFIG ---------------- */

const MSP_ID = "Org1MSP";
const CHANNEL_NAME = "mychannel";
const CHAINCODE_NAME = "wateralloc";

const PEER_ENDPOINT = "localhost:7051";
const PEER_HOST_ALIAS = "peer0.org1.example.com";

const USER_MSP_PATH =
  "/home/mahad123/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp";

const CERT_PATH = path.join(USER_MSP_PATH, "signcerts", "cert.pem");
const KEYSTORE_PATH = path.join(USER_MSP_PATH, "keystore");

const TLS_CERT_PATH =
  "/home/mahad123/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt";

/* ---------------- HELPERS ---------------- */

function readFile(p) {
  if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
  return fs.readFileSync(p);
}

function getPrivateKeyPath() {
  const files = fs.readdirSync(KEYSTORE_PATH);
  if (files.length !== 1) {
    throw new Error(`Expected 1 key, found ${files.length}`);
  }
  return path.join(KEYSTORE_PATH, files[0]);
}

/* ---------------- CONNECTION ---------------- */

function newGrpcConnection() {
  const tlsCert = readFile(TLS_CERT_PATH);
  const creds = grpc.credentials.createSsl(tlsCert);

  return new grpc.Client(PEER_ENDPOINT, creds, {
    "grpc.ssl_target_name_override": PEER_HOST_ALIAS,
    "grpc.default_authority": PEER_HOST_ALIAS,
  });
}

function newIdentity() {
  return {
    mspId: MSP_ID,
    credentials: readFile(CERT_PATH),
  };
}

function newSigner() {
  const privateKeyPem = readFile(getPrivateKeyPath());
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  return signers.newPrivateKeySigner(privateKey);
}

async function getContract() {
  const client = newGrpcConnection();

  const gateway = connect({
    client,
    identity: newIdentity(),
    signer: newSigner(),
  });

  const network = gateway.getNetwork(CHANNEL_NAME);
  const contract = network.getContract(CHAINCODE_NAME);

  return { gateway, client, contract };
}

/* ---------------- FABRIC CALLS ---------------- */

async function createWaterAllocation({ id, farmerId, allocatedVolume, timestamp }) {
  const { gateway, client, contract } = await getContract();

  try {
    const proposal = await contract.newProposal("createWaterAllocation", {
      arguments: [
        String(id),
        String(farmerId),
        String(Math.floor(allocatedVolume)),
        String(timestamp),
      ],
    });

    const endorsed = await proposal.endorse();
    const commit = await endorsed.submit();
    await commit.getStatus();

    return { txId: commit.getTransactionId() };
  } finally {
    gateway.close();
    client.close();
  }
}

async function addAdditionalAllocation({ baseId, additionalVolume, timestamp }) {
  const { gateway, client, contract } = await getContract();

  try {
    const proposal = await contract.newProposal("addAdditionalAllocation", {
      arguments: [
        String(baseId),
        String(Math.floor(additionalVolume)),
        String(timestamp),
      ],
    });

    const endorsed = await proposal.endorse();
    const commit = await endorsed.submit();
    await commit.getStatus();

    return { txId: commit.getTransactionId() };
  } finally {
    gateway.close();
    client.close();
  }
}

module.exports = {
  createWaterAllocation,
  addAdditionalAllocation,
};