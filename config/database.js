const dns = require("dns");
const mongoose = require("mongoose");

function configureDns() {
  const servers = process.env.DNS_SERVERS
    ? process.env.DNS_SERVERS.split(",").map((s) => s.trim()).filter(Boolean)
    : ["1.1.1.1", "8.8.8.8"];

  if (process.env.MONGO_URI?.startsWith("mongodb+srv://")) {
    dns.setServers(servers);
  }
}

async function connectMongo(uri = process.env.MONGO_URI) {
  if (!uri) {
    throw new Error("MONGO_URI is not set in .env");
  }

  configureDns();

  return mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15000,
  });
}

module.exports = { configureDns, connectMongo };
