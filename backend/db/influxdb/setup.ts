import dotenv from 'dotenv';
dotenv.config();

import { InfluxDB, Point } from '@influxdata/influxdb-client';

const token = process.env.INFLUXDB_TOKEN as string;
const url = process.env.INFLUXDB_URL || 'http://localhost:8086';


console.log('DEBUG - Token:', token);
console.log('DEBUG - URL:', url);

const client = new InfluxDB({ url, token });

const org = `local-org`;
const bucket = `microgrid-data`;

const writeClient = client.getWriteApi(org, bucket, 'ns');
const queryClient = client.getQueryApi(org);

export async function checkConnection(): Promise<boolean> {
  try {
    const query = `from(bucket: "${bucket}") |> range(start: -1m) |> limit(n: 1)`;
    
    return new Promise((resolve, reject) => {
      queryClient.queryRows(query, {
        next: () => {
          console.log('Successfully connected to InfluxDB');
          resolve(true);
        },
        error: (error: any) => {
          console.error('InfluxDB connection error:', error);
          reject(false);
        },
        complete: () => {
          console.log('Query completed - connection successful');
          resolve(true);
        }
      });
    });
  } catch (error) {
    console.error('Connection check failed:', error);
    return false;
  }
}

export function writeRealtimeReading(
  meterId: string, 
  nodeType: string, 
  readings: {
    p_active: number;
    p_reactive: number;
    voltage: number;
    current: number;
    frequency: number;
  }
) {
  try {
    const point = new Point('realtime_readings')
      .tag('meter_id', meterId)
      .tag('node_type', nodeType)
      .floatField('p_active', readings.p_active)
      .floatField('p_reactive', readings.p_reactive)
      .floatField('voltage', readings.voltage)
      .floatField('current', readings.current)
      .floatField('frequency', readings.frequency);

    writeClient.writePoint(point);
    console.log(`Real-time data written for meter: ${meterId}`);
  } catch (error) {
    console.error('Error writing real-time reading:', error);
  }
}

export function writeAggregatedUsage(
  meterId: string, 
  nodeType: string, 
  timeOfUseTier: string, 
  aggregation: {
    energy_kwh: number;
    max_demand_kw: number;
  }
) {
  try {
    const point = new Point('aggregated_usage')
      .tag('meter_id', meterId)
      .tag('node_type', nodeType)
      .tag('time_of_use_tier', timeOfUseTier)
      .floatField('energy_kwh', aggregation.energy_kwh)
      .floatField('max_demand_kw', aggregation.max_demand_kw);

    writeClient.writePoint(point);
    console.log(`Aggregated usage written for meter: ${meterId}`);
  } catch (error) {
    console.error('Error writing aggregated usage:', error);
  }
}

export function writeDailySummary(
  meterId: string, 
  nodeType: string, 
  summary: {
    net_kwh_consumed: number;
    net_kwh_produced: number;
    total_cost: number;
    peak_demand_kw: number;
  }
) {
  try {
    const point = new Point('daily_summary')
      .tag('meter_id', meterId)
      .tag('node_type', nodeType)
      .floatField('net_kwh_consumed', summary.net_kwh_consumed)
      .floatField('net_kwh_produced', summary.net_kwh_produced)
      .floatField('total_cost', summary.total_cost)
      .floatField('peak_demand_kw', summary.peak_demand_kw);

    writeClient.writePoint(point);
    console.log(`Daily summary written for meter: ${meterId}`);
  } catch (error) {
    console.error('Error writing daily summary:', error);
  }
}

export function writeMLInference(
  meterId: string, 
  inferenceType: string, 
  inference: {
    appliance_kwh_estimated: number;
    anomaly_score: number;
    alert_flag: boolean;
  }
) {
  try {
    const point = new Point('ml_inferences')
      .tag('meter_id', meterId)
      .tag('inference_type', inferenceType)
      .floatField('appliance_kwh_estimated', inference.appliance_kwh_estimated)
      .floatField('anomaly_score', inference.anomaly_score)
      .booleanField('alert_flag', inference.alert_flag);

    writeClient.writePoint(point);
    console.log(`ML inference written for meter: ${meterId}`);
  } catch (error) {
    console.error('Error writing ML inference:', error);
  }
}

export function flushWrites() {
  try {
    writeClient.flush();
    console.log('Data flushed to InfluxDB');
  } catch (error) {
    console.error('Error flushing writes:', error);
  }
}

export function closeConnection() {
  try {
    writeClient.close().then(() => {
      console.log('Write client closed');
    });
  } catch (error) {
    console.error('Error closing connection:', error);
  }
}


export { client, writeClient, queryClient, org, bucket };