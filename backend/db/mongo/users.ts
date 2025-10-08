import mongoose, { Schema, Document } from "mongoose";

interface IUser extends Document {
  _id: string;
  meter_id: string;
  username: string;
  password: string;
  roles: string[];
  settings: {
    thresholds?: {
      consumption_limit?: number;
      cost_limit?: number;
    };
    budget_goals?: {
      monthly_budget?: number;
      daily_budget?: number;
    };
    alert_preferences?: {
      email_alerts?: boolean;
      sms_alerts?: boolean;
      threshold_alerts?: boolean;
    };
    [key: string]: any; 
  };
  created_at: Date;
  Updated_at: Date;

}

const UserSchema = new Schema<IUser>(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3
    },
    password: {
      type: String,
      required: true
    },
    meter_id: {
      type: String,
      required: true,
      ref: 'Meter'
    },
    roles: {
      type: [String],
      required: true,
      enum: ['consumer', 'factory_manager', 'grid_operator', 'admin'],
      default: ['consumer']
    },
    settings: {
      type: Schema.Types.Mixed,
      default: {
        thresholds: {},
        budget_goals: {},
        alert_preferences: {
          email_alerts: true,
          sms_alerts: false,
          threshold_alerts: true
        }
      }
    }
  },
  {
    timestamps: true 
  }
);

export const User = mongoose.model<IUser>('User', UserSchema);