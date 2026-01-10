/**
 * Manage Salary Bot - Handles P2P orders from Binance and processes them into records.
 * Polls for new orders and manages payments.
 */

import { config } from "dotenv";
import { C2C } from "@binance/c2c";
import { Spot } from "@binance/connector";
import { z } from "zod";
import { createHmac } from "crypto";

config();

const IN_OUT_RECORD_TYPES = ["in", "out"] as const;

/**
 * Zod schema for In/Out records parsed from P2P orders.
 * Represents transactions with amount, type, currency, etc.
 */
export const InOutRecord = z.object({
  amount: z.preprocess((a) => BigInt(a?.toString() || 0), z.string()), // Amount as string (multiplied by 100)
  type: z.enum(IN_OUT_RECORD_TYPES), // 'in' for buy, 'out' for sell
  currency: z.preprocess((a) => a?.toString().toUpperCase(), z.string()), // Asset like 'USDT'
  // user: z.unknown(), // Counterpart nickname
  description: z.string(), // Description of the transaction
  tag: z.unknown(), // Additional tags
  externalId: z.string().optional(), // Unique ID prefixed with 'BN-'
  date: z.string(), // Transaction date as ISO string

  secondaryAmount: z.string().optional(),
  secondaryCurrency: z
    .preprocess((a) => a?.toString().toUpperCase(), z.string())
    .optional(),

  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

/**
 * Binance C2C client for P2P API interactions.
 */
const c2cClient = new C2C({
  configurationRestAPI: {
    apiKey: process.env.BINANCE_API_KEY!,
    apiSecret: process.env.BINANCE_API_SECRET!,
  },
});

/**
 * Binance Spot client for deposit/withdrawal API interactions.
 */
const spotClient = new Spot(
  process.env.BINANCE_API_KEY!,
  process.env.BINANCE_API_SECRET!,
);

/**
 * Global variable to track the last fetched timestamp for optimization.
 * Initialized to START_DATE or Unix epoch if not set.
 */
let lastFetchedTimestamp: number = process.env.START_DATE
  ? Date.parse(process.env.START_DATE)
  : 0;

/**
 * Parses a Binance P2P order into an InOutRecord.
 * @param order - The raw order data from Binance API.
 * @returns Parsed InOutRecord.
 */
function parseOrderToRecord(order: any): z.infer<typeof InOutRecord> {
  const amount = Math.round(parseFloat(order.amount) * 100).toString(); // multiply by 100 for backend bigint handling
  const type = order.tradeType === "BUY" ? "in" : "out";
  const currency = order.asset;
  const user = order.counterPartNickName;
  const description = `P2P ${order.tradeType} ${order.asset} for ${order.fiat}`;
  const tag = null; // unknown
  const date = new Date(order.createTime).toISOString();

  return {
    amount,
    type,
    currency,
    description,
    tag,
    externalId: `BN-${order.orderNumber}`,
    date,
    secondaryAmount: order.fiatAmount
      ? Math.round(parseFloat(order.fiatAmount) * 100).toString()
      : undefined,
    secondaryCurrency: order.fiat,
  };
}

/**
 * Fetches P2P trade history from Binance, filtered by START_DATE if set.
 * Parses orders into InOutRecord format.
 * @returns Object with raw orders and parsed records.
 */
async function getP2POrders(): Promise<{
  data: any[];
  records: z.infer<typeof InOutRecord>[];
}> {
  try {
    const startTimestamp = lastFetchedTimestamp || undefined;
    const res = await c2cClient.restAPI.getC2CTradeHistory({ startTimestamp });
    const data = await res.data();
    const records = data.data ? data.data.map(parseOrderToRecord) : [];
    return { data: data.data || [], records };
  } catch (error) {
    console.error("Error getting P2P orders:", error);
    return { data: [], records: [] };
  }
}

/**
 * Fetches existing externalIds from the API to avoid duplicates.
 * @returns Set of existing externalIds.
 */
async function getExistingExternalIds(): Promise<Set<string>> {
  try {
    const response = await fetch(`${process.env.HOST}/api/records`, {
      method: "GET",
      headers: {
        ["x-api-key"]: `${process.env.API_KEY}`,
      },
    });
    if (response.ok) {
      const data = await response.json() as any[];
      // Assuming the API returns records with externalId field
      return new Set(
        data.map((record: any) => record.externalId).filter(Boolean),
      );
    }
  } catch (error) {
    console.error("Error fetching existing records:", error);
  }
  return new Set();
}

/**
 * Sends parsed records to the configured API endpoint, filtering out duplicates.
 * @param records - Array of InOutRecord to send.
 */
async function sendRecords(records: z.infer<typeof InOutRecord>[]) {
  try {
    // Get existing externalIds to filter duplicates
    const existingIds = await getExistingExternalIds();
    const newRecords = records.filter(
      (record) => record.externalId && !existingIds.has(record.externalId),
    );

    if (newRecords.length === 0) {
      console.log("No new records to send");
      return;
    }

    console.log(
      `Sending ${newRecords.length} new records (filtered ${records.length - newRecords.length} duplicates)`,
    );

    const response = await fetch(`${process.env.HOST}/api/records/bulk`, {
      method: "POST",
      headers: {
        ["x-api-key"]: `${process.env.API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ records: newRecords }),
    });
    if (!response.ok) {
      console.error(`Failed to send record: ${await response.clone().text()}`);
    }
  } catch (error) {
    console.error("Error sending record:", error);
  }
}

/**
 * Parses a Binance Pay transaction into an InOutRecord.
 * @param transaction - The raw transaction data from Binance Pay API.
 * @returns Parsed InOutRecord.
 */
function parsePayTransactionToRecord(
  transaction: any,
): z.infer<typeof InOutRecord> {
  const amountStr = transaction.amount;
  const amount = Math.round(
    parseFloat(amountStr.startsWith("-") ? amountStr.substring(1) : amountStr) *
      100,
  ).toString();
  // If amount is negative, we sent money (out), else we received (in)
  const type = amountStr.startsWith("-") ? "out" : "in";
  const currency = transaction.currency;
  const user =
    type === "out"
      ? transaction.receiverInfo?.name ||
        transaction.receiverInfo?.email ||
        "Unknown"
      : transaction.payerInfo?.name ||
        transaction.payerInfo?.email ||
        "Unknown";
  const description = `Binance Pay ${type === "out" ? "to" : "from"} ${user}`;
  const tag = null;
  const date = new Date(transaction.transactionTime).toISOString();

  return {
    amount,
    type,
    currency,
    description,
    tag,
    externalId: `PAY-${transaction.transactionId}`,
    date,
  };
}

/**
 * Fetches Binance Pay transaction history, filtered by START_DATE if set.
 * Parses transactions into InOutRecord format.
 * @returns Array of parsed records.
 */
async function getPayTransactions(): Promise<z.infer<typeof InOutRecord>[]> {
  try {
    const startTime = lastFetchedTimestamp || undefined;

    // Direct API call to Binance Pay since @binance/connector doesn't have payTransactions
    const timestamp = Date.now();
    const queryString = new URLSearchParams({
      timestamp: timestamp.toString(),
      ...(startTime && { startTime: startTime.toString() }),
    }).toString();

    const signature = createHmac("sha256", process.env.BINANCE_API_SECRET!)
      .update(queryString)
      .digest("hex");

    const response = await fetch(
      `https://api.binance.com/sapi/v1/pay/transactions?${queryString}&signature=${signature}`,
      {
        method: "GET",
        headers: {
          "X-MBX-APIKEY": process.env.BINANCE_API_KEY!,
        },
      },
    );

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(
        `Binance API error: ${response.status} ${response.statusText} - ${responseText}`,
      );
    }

    const data = (await response.json()) as any;
    if (data.code !== "000000") {
      throw new Error(`Binance API error: ${data.code} ${data.message}`);
    }
    const transactions = data.data || [];
    const records = transactions.map(parsePayTransactionToRecord);
    return records;
  } catch (error) {
    console.error("Error getting pay transactions:", error);
    return [];
  }
}

/**
 * Parses a Binance deposit into an InOutRecord.
 * @param deposit - The raw deposit data from Binance API.
 * @returns Parsed InOutRecord.
 */
function parseDepositToRecord(deposit: any): z.infer<typeof InOutRecord> {
  const amount = Math.round(parseFloat(deposit.amount) * 100).toString();
  const type = "in" as const;
  const currency = deposit.asset || "USD";
  const description = `Deposit ${deposit.asset} to Binance`;
  const tag = null;
  const date = new Date(deposit.insertTime).toISOString();

  return {
    amount,
    type,
    currency,
    description,
    tag,
    externalId: `BN-${deposit.txId}`,
    date,
  };
}

/**
 * Fetches deposit history from Binance, filtered by START_DATE if set.
 * Parses deposits into InOutRecord format.
 * @returns Array of parsed records.
 */
async function getDeposits(): Promise<z.infer<typeof InOutRecord>[]> {
  try {
    const startTime = lastFetchedTimestamp || undefined;
    const res = await spotClient.depositHistory({ startTime });
    const deposits = res.data;
    const records = deposits.map(parseDepositToRecord);
    return records;
  } catch (error) {
    console.error("Error getting deposits:", error);
    return [];
  }
}

const getOrders = () => {
  return Promise.all([getP2POrders(), getDeposits(), getPayTransactions()]);
};

/**
 * Polls for incoming actions (new orders) every minute.
 */
async function handleIncomingActions() {
  // Poll for new orders every minute
  setInterval(async () => {
    const orders = await getOrders();
    const allRecords = orders.flatMap((o) => ("records" in o ? o.records : o));
    await sendRecords(allRecords);

    // Update lastFetchedTimestamp to the latest timestamp from fetched data
    if (allRecords.length > 0) {
      const maxTimestamp = Math.max(...allRecords.map(r => Date.parse(r.date)));
      lastFetchedTimestamp = maxTimestamp;
    }
  }, 60000); // 1 minute
}

// Main function
async function main() {
  const p2p = await getP2POrders();
  await sendRecords(p2p.records);

  const deposits = await getDeposits();
  console.log(deposits);
  await sendRecords(deposits);

  const pays = await getPayTransactions();
  await sendRecords(pays);

  // Collect all records to update timestamp
  const allRecords = [...p2p.records, ...deposits, ...pays];
  if (allRecords.length > 0) {
    const maxTimestamp = Math.max(...allRecords.map(r => Date.parse(r.date)));
    lastFetchedTimestamp = maxTimestamp;
  }

  // Note: handleIncomingActions() is not suitable for serverless due to execution limits
  // For continuous polling, consider using a different hosting platform
}

// For Vercel deployment as serverless function
export default async function handler(req: any, res: any) {
  try {
    await main();
    res.status(200).json({ message: "Bot executed successfully" });
  } catch (error) {
    console.error("Error in handler:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

// Uncomment the line below if you want to run locally with polling
// handleIncomingActions();
