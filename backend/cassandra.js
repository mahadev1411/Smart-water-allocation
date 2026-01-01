const cassandra = require("cassandra-driver");

const client = new cassandra.Client({
  contactPoints: ["127.0.0.1"],
  localDataCenter: "datacenter1", // default in docker Cassandra
  keyspace: "water_chain",
});

module.exports = client;
