// db/connect.ts
import mongoose from 'mongoose';

export const connectDB = async () => {
  try {

    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/smartMeterUsers';
    await mongoose.connect(mongoUri);
    console.log('MongoDB connected');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
};
