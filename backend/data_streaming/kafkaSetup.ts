import { Kafka, Producer, Consumer, EachMessagePayload, logLevel } from 'kafkajs';
import dotenv from 'dotenv';

dotenv.config();


const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const CLIENT_ID = 'microgrid-backend-service';

if (KAFKA_BROKERS.length === 0 || !KAFKA_BROKERS[0]) {
  console.error("KAFKA_BROKERS environment variable is not set or is empty.");

}

export const TOPICS = {
  METER_READINGS_RAW: 'meter-readings-raw',
  BILLING_CALCULATIONS: 'billing-calculations',
  ML_ALERTS: 'ml-alerts',
  CONTROL_SIGNALS: 'control-signals',
} as const;


export interface RealtimeReadingMessage {
  meterId: string;
  timestamp: number; 
  p_active: number;  
  p_reactive: number; 
  voltage: number;   
  current: number;   
  frequency: number; 
}

export interface BillingCalculationMessage {
  meterId: string;
  intervalStart: number;
  intervalEnd: number;
  energyKwh: number;
  calculatedCost: number;
  touTier: string;
}

export interface MLAlertMessage {
  meterId: string;
  inferenceType: 'NILM' | 'Anomaly' | string;
  timestamp: number;
  alertFlag: boolean;
  anomalyScore?: number;
  details: Record<string, any>;
}

export interface ControlSignalMessage {
  meterId: string;
  command: 'SHUTDOWN_PV' | 'LOAD_SHED' | 'RESUME_LOAD' | string;
  value: number; 
  priority: number;
}

export class MicrogridKafkaClient {
  private kafka: Kafka;
  private producer: Producer;

  constructor() {
    this.kafka = new Kafka({
      clientId: CLIENT_ID,
      brokers: KAFKA_BROKERS,
      logLevel: process.env.NODE_ENV === 'production' ? logLevel.WARN : logLevel.INFO,
      retry: {
        initialRetryTime: 100,
        retries: 8,
      },
    });

    this.producer = this.kafka.producer({
      allowAutoTopicCreation: false, 
    });
  }

  public async connectProducer(): Promise<void> {
    try {
      await this.producer.connect();
      console.log('Kafka Producer connected successfully.');
    } catch (error) {
      console.error('Failed to connect Kafka Producer:', error);
      throw error;
    }
  }

  public async disconnectProducer(): Promise<void> {
    try {
      await this.producer.disconnect();
      console.log('Kafka Producer disconnected.');
    } catch (error) {
      console.error('Error disconnecting Kafka Producer:', error);
    }
  }

  public async publishRealtimeReading(message: RealtimeReadingMessage): Promise<void> {
    const topic = TOPICS.METER_READINGS_RAW;
    try {
      await this.producer.send({
        topic: topic,
        messages: [
          {
            key: message.meterId,
            value: JSON.stringify(message),
          },
        ],
      });
    } catch (error) {
      console.error(`Error publishing to ${topic} for meter ${message.meterId}:`, error);
    }
  }

  public async publishBillingCalculation(message: BillingCalculationMessage): Promise<void> {
    const topic = TOPICS.BILLING_CALCULATIONS;
    try {
      await this.producer.send({
        topic: topic,
        messages: [
          {
            key: message.meterId,
            value: JSON.stringify(message),
          },
        ],
      });
    } catch (error) {
      console.error(`Error publishing to ${topic} for meter ${message.meterId}:`, error);
    }
  }

  public async publishMLAlert(message: MLAlertMessage): Promise<void> {
    const topic = TOPICS.ML_ALERTS;
    try {
      await this.producer.send({
        topic: topic,
        messages: [
          {
            key: message.meterId,
            value: JSON.stringify(message),
          },
        ],
      });
    } catch (error) {
      console.error(`Error publishing to ${topic} for meter ${message.meterId}:`, error);
    }
  }

  public async publishControlSignal(message: ControlSignalMessage): Promise<void> {
    const topic = TOPICS.CONTROL_SIGNALS;
    try {
      await this.producer.send({
        topic: topic,
        messages: [
          {
            key: message.meterId,
            value: JSON.stringify(message),
          },
        ],
      });
    } catch (error) {
      console.error(`Error publishing to ${topic} for meter ${message.meterId}:`, error);
    }
  }

  /**
   * Starts a persistent consumer instance for a given topic and handler function.
   * @param groupId Unique group ID for the consumer service (e.g., 'data-aggregator-group').
   * @param topic Topic to subscribe to.
   * @param handler The function to process each received message.
   */
  public async startConsumer(
    groupId: string,
    topic: string,
    handler: (message: EachMessagePayload) => Promise<void>
  ): Promise<Consumer> {
    const consumer = this.kafka.consumer({ groupId });

    try {
      await consumer.connect();
      await consumer.subscribe({ topic, fromBeginning: false });

      await consumer.run({
        eachMessage: async (payload) => {
          try {
            await handler(payload);
          } catch (e) {
            console.error(`Error processing message in group ${groupId} from topic ${topic}:`, e);
            // In a real scenario, implement Dead Letter Queue (DLQ) logic here
          }
        },
      });

      console.log(`Kafka Consumer group '${groupId}' subscribed to topic: ${topic}`);
      return consumer;
    } catch (error) {
      console.error(`Failed to start consumer for group ${groupId}:`, error);
      throw error;
    }
  }
}

// Example usage and boilerplate for graceful shutdown
async function main() {
    const client = new MicrogridKafkaClient();

    // 1. Connect Producer for publishing data (e.g., in a Simulator Service)
    // await client.connectProducer();
    
    // 2. Start a Consumer for processing data (e.g., in an Aggregation Service)
    /*
    const aggregationConsumer = await client.startConsumer(
        'data-aggregator-group', 
        TOPICS.METER_READINGS_RAW, 
        async ({ topic, partition, message }) => {
            const reading = JSON.parse(message.value?.toString() || '{}') as RealtimeReadingMessage;
            // This is where you would call writeRealtimeReading(reading.meterId, ...)
            // console.log(`[AGGREGATOR] Received raw reading from ${reading.meterId}: ${reading.p_active}kW`);
        }
    );
    */

    const shutdown = async () => {
        // await aggregationConsumer.disconnect();
        await client.disconnectProducer();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

// main();