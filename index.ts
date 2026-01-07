import { config } from 'dotenv';
import { C2C } from '@binance/c2c';

config();

const client = new C2C({
  configurationRestAPI: {
    apiKey: process.env.BINANCE_API_KEY!,
    apiSecret: process.env.BINANCE_API_SECRET!,
  },
});

async function getP2POrders() {
  try {
    const res = await client.restAPI.getC2CTradeHistory();
    const data = await res.data();
    console.log('P2P Orders:', data);
    return data;
  } catch (error) {
    console.error('Error getting P2P orders:', error);
  }
}

async function payOrders() {
  try {
    const orders = await getP2POrders();
    if (!orders || !orders.data) return;

    for (const order of orders.data) {
      if (order.orderStatus === 'BUYER_PAYED' && order.advertisementRole === 'MAKER') {
        // TODO: Implement release crypto logic once SDK supports changeOrderMatchStatus
        console.log(`Need to release crypto for paid order ${order.orderNumber}`);
      }
    }
  } catch (error) {
    console.error('Error processing orders:', error);
  }
}

async function handleIncomingActions() {
  // Poll for new orders every minute
  setInterval(async () => {
    console.log('Checking for incoming actions...');
    await payOrders();
  }, 60000); // 1 minute
}

// Main function
async function main() {
  console.log('Starting manage salary bot...');
  await getP2POrders();
  handleIncomingActions();
}

main();