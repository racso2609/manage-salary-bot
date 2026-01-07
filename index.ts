import { config } from "dotenv";
import { C2C } from "@binance/c2c";
import { z } from "zod";

config();

const IN_OUT_RECORD_TYPES = ["IN", "OUT"] as const;

export const InOutRecord = z.object({
  // amount incoming if currency is usd 2 zeros for decimals
  amount: z.preprocess((a) => BigInt(a?.toString() || 0), z.bigint()),
  type: z.enum(IN_OUT_RECORD_TYPES),
  currency: z.preprocess((a) => a?.toString().toUpperCase(), z.string()),
  description: z.string(),
  tag: z.unknown(),
  externalId: z.string().optional(),
  date: z.date(),

  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

const client = new C2C({
  configurationRestAPI: {
    apiKey: process.env.BINANCE_API_KEY!,
    apiSecret: process.env.BINANCE_API_SECRET!,
  },
});

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
    // BN = binance
    externalId: `BN-${order.orderNumber}`,
    description,
    tag,
    date,
  };
}

async function getP2POrders() {
  try {
    const startTimestamp = process.env.START_DATE ? Date.parse(process.env.START_DATE) : undefined;
    const res = await client.restAPI.getC2CTradeHistory({ startTimestamp });
    const data = await res.data();
    console.log("P2P Orders:", data);
    const records = data.data ? data.data.map(parseOrderToRecord) : [];
    console.log("Parsed Records:", records);
    return { ...data, records };
  } catch (error) {
    console.error("Error getting P2P orders:", error);
  }
}

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
  handleIncomingActions();
}

main();
