
export interface RatePlan {
    costKwh: number;
    FixedFee?: number;
    demandCharges?: {
        type: "peak" | "offpeak";
        costPerKw: number;
    }[];
    touTiers?: {              
    startHour: number;
    endHour: number;
    costPerKwh: number;
  }[];
}

