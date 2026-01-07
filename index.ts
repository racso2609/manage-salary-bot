/**
 * Manage Salary Bot - Handles P2P orders from Binance and processes them into records.
 * Polls for new orders and manages payments.
 */

import { config } from "dotenv";
import { C2C } from "@binance/c2c";
import { Spot } from "@binance/connector";
import { z } from "zod";

config();

const IN_OUT_RECORD_TYPES = ["IN", "OUT"] as const;

/**
 * Zod schema for In/Out records parsed from P2P orders.
 * Represents transactions with amount, type, currency, etc.
 */
export const InOutRecord = z.object({
  amount: z.preprocess((a) => BigInt(a?.toString() || 0), z.bigint()), // Crypto amount as BigInt
  type: z.enum(IN_OUT_RECORD_TYPES), // 'IN' for buy, 'OUT' for sell
  currency: z.preprocess((a) => a?.toString().toUpperCase(), z.string()), // Asset like 'USDT'
  user: z.unknown(), // Counterpart nickname
  description: z.string(), // Description of the transaction
  tag: z.unknown(), // Additional tags
  externalId: z.string().optional(), // Unique ID prefixed with 'BN-'
  date: z.date(), // Transaction date

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
const spotClient = new Spot(process.env.BINANCE_API_KEY!, process.env.BINANCE_API_SECRET!);

/**
 * Parses a Binance P2P order into an InOutRecord.
 * @param order - The raw order data from Binance API.
 * @returns Parsed InOutRecord.
 */
function parseOrderToRecord(order: any): z.infer<typeof InOutRecord> {
  const amount = order.amount; // already string, preprocess will handle
  const type = order.tradeType === "BUY" ? "IN" : "OUT";
  const currency = order.asset;
  const user = order.counterPartNickName;
  const description = `P2P ${order.tradeType} ${order.asset} for ${order.fiat}`;
  const tag = null; // unknown
  const date = new Date(order.createTime);

  return {
    amount,
    type,
    currency,
    user,
    description,
    tag,
    externalId: `BN-${order.orderNumber}`,
    date,
  };
}

/**
 * Fetches P2P trade history from Binance, filtered by START_DATE if set.
 * Parses orders into InOutRecord format.
 * @returns Object with raw data and parsed records.
 */
async function getP2POrders() {
  try {
    const startTimestamp = process.env.START_DATE
      ? Date.parse(process.env.START_DATE)
      : undefined;
    const res = await c2cClient.restAPI.getC2CTradeHistory({ startTimestamp });
    const data = await res.data();
    console.log("P2P Orders:", data);
    const records = data.data ? data.data.map(parseOrderToRecord) : [];
    console.log("Parsed Records:", records);
    return { ...data, records };
  } catch (error) {
    console.error("Error getting P2P orders:", error);
  }
}

/**
 * Parses a Binance deposit into an InOutRecord.
 * @param deposit - The raw deposit data from Binance API.
 * @returns Parsed InOutRecord.
 */
function parseDepositToRecord(deposit: any): z.infer<typeof InOutRecord> {
  const amount = deposit.amount;
  const type = 'IN' as const;
  const currency = deposit.asset;
  const user = null; // Deposits don't have counterpart
  const description = `Deposit ${deposit.asset} to Binance`;
  const tag = null;
  const date = new Date(deposit.insertTime);

  return {
    amount,
    type,
    currency,
    user,
    description,
    tag,
    externalId: `DEP-${deposit.txId}`,
    date,
  };
}

/**
 * Fetches deposit history from Binance, filtered by START_DATE if set.
 * Parses deposits into InOutRecord format.
 * @returns Array of parsed records.
 */
async function getDeposits() {
  try {
    const startTime = process.env.START_DATE
      ? Date.parse(process.env.START_DATE)
      : undefined;
    const res = await spotClient.depositHistory({ startTime });
    const deposits = res.data;
    console.log("Deposits:", deposits);
    const records = deposits.map(parseDepositToRecord);
    console.log("Parsed Deposit Records:", records);
    return records;
  } catch (error) {
    console.error("Error getting deposits:", error);
  }
}

/**
 * Processes paid orders by checking for BUYER_PAYED status and releasing crypto.
 * TODO: Implement actual crypto release once SDK supports it.
 */
async function payOrders() {
  try {
    const orders = await getP2POrders();
    if (!orders || !orders.data) return;

    for (const order of orders.data) {
      if (
        order.orderStatus === "BUYER_PAYED" &&
        order.advertisementRole === "MAKER"
      ) {
        // TODO: Implement release crypto logic once SDK supports changeOrderMatchStatus
        console.log(
          `Need to release crypto for paid order ${order.orderNumber}`,
        );
      }
    }
  } catch (error) {
    console.error("Error processing orders:", error);
  }
}

/**
 * Polls for incoming actions (new orders) every minute.
 */
async function handleIncomingActions() {
  // Poll for new orders every minute
  setInterval(async () => {
    console.log("Checking for incoming actions...");
    await payOrders();
  }, 60000); // 1 minute
}

// Main function
async function main() {
  console.log("Starting manage salary bot...");
  await getP2POrders();
  await getDeposits();
  handleIncomingActions();
}

main();
