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

  secondaryAmount: z
    .preprocess((a) => BigInt(a?.toString() || 0), z.bigint())
    .optional(),
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
    secondaryAmount: order.fiatAmount,
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
    const startTimestamp = process.env.START_DATE
      ? Date.parse(process.env.START_DATE)
      : undefined;
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
 * Sends parsed records to the configured API endpoint.
 * @param records - Array of InOutRecord to send.
 */
async function sendRecords(records: z.infer<typeof InOutRecord>[]) {
  // for (const record of records) {
  //   try {
  //     const response = await fetch(`${process.env.HOST}/api/records`, {
  //       method: "POST",
  //       headers: {
  //         Authorization: `Bearer ${process.env.API_KEY}`,
  //         "Content-Type": "application/json",
  //       },
  //       body: JSON.stringify(record),
  //     });
  //     if (!response.ok) {
  //       console.error(`Failed to send record: ${response.statusText}`);
  //     }
  //   } catch (error) {
  //     console.error("Error sending record:", error);
  //   }
  // }
}

/**
 * Parses a Binance Pay transaction into an InOutRecord.
 * @param transaction - The raw transaction data from Binance Pay API.
 * @returns Parsed InOutRecord.
 */
function parsePayTransactionToRecord(
  transaction: any,
): z.infer<typeof InOutRecord> {
  const amount = transaction.amount;
  // Placeholder: Determine type based on if you are receiver or payer
  // For PAY, if receiverInfo has binanceId, assume 'IN', else 'OUT'
  const isReceiver = transaction.receiverInfo?.binanceId; // Placeholder check
  const type = isReceiver ? "IN" : "OUT";
  const currency = transaction.currency || "UNKNOWN";
  const user =
    transaction.payerInfo?.name || transaction.receiverInfo?.name || "Unknown";
  const description = `Binance Pay: ${transaction.payerInfo?.name || "Unknown"} to ${transaction.receiverInfo?.name || "Unknown"}`;
  const tag = null;
  const date = new Date(transaction.createTime);

  return {
    amount,
    type,
    currency,
    user,
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
    const startTime = process.env.START_DATE
      ? Date.parse(process.env.START_DATE)
      : undefined;
    // Note: @binance/connector may not have payTransactions; if not, use direct axios call
    const res = await (spotClient as any).payTransactions({ startTime });
    const transactions = res.data;
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
  const amount = deposit.amount;
  const type = "IN" as const;
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
    const startTime = process.env.START_DATE
      ? Date.parse(process.env.START_DATE)
      : undefined;
    const res = await spotClient.depositHistory({ startTime });
    const deposits = res.data;
    const records = deposits.map(parseDepositToRecord);
    return records;
  } catch (error) {
    console.error("Error getting deposits:", error);
    return [];
  }
}

/**
 * Polls for incoming actions (new orders) every minute.
 */
async function handleIncomingActions() {
  // Poll for new orders every minute
  setInterval(async () => {
    const p2p = await getP2POrders();
    await sendRecords(p2p.records);
  }, 60000); // 1 minute
}

// Main function
async function main() {
  const p2p = await getP2POrders();
  await sendRecords(p2p.records);

  const deposits = await getDeposits();
  await sendRecords(deposits);

  const pays = await getPayTransactions();
  await sendRecords(pays);

  handleIncomingActions();
}

main();
