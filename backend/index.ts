import dotenv from 'dotenv';
dotenv.config();

import { connectDB } from "./db/mongo/connect";
import { checkConnection, flushWrites, closeConnection} from "./db/influxdb/setup";

// For MongoDB connection
connectDB();

// For InfluxDB
async function initializeDatabase() {
  try {
    const isConnected = await checkConnection();
    if (isConnected) {
      console.log('Successfully connected to InfluxDB');
    } else {
      console.log('Failed to connect to InfluxDB - check credentials');
    }
  } catch (error) {
    console.error('Error initializing InfluxDB:', error);
  }
}

initializeDatabase().catch(console.error);

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  flushWrites();
  closeConnection();
  process.exit(0);
});

// Flush writes every 30 seconds
setInterval(flushWrites, 30000);