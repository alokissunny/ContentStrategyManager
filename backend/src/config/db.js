const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGO_URI;
  // Keep a small warm pool so a StrictMode double-mount of 8 GETs does not
  // serialize behind a single cold Atlas connection on M0.
  await mongoose.connect(uri, {
    maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE) > 0 ? Number(process.env.MONGO_MAX_POOL_SIZE) : 20,
    minPoolSize: 1,
    serverSelectionTimeoutMS: 8_000,
  });
  console.log(`MongoDB connected: ${mongoose.connection.host}`);
}

module.exports = connectDB;
