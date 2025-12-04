import { config } from 'dotenv';
config({ path: '.env.local' });
import { getChat } from '../src/lib/db/actions';

const chatId = process.argv[2];
const userId = process.argv[3];

if (!chatId || !userId) {
  console.error('Usage: tsx scripts/debug-getChat.ts <chatId> <userId>');
  process.exit(1);
}

async function main() {
  const chat = await getChat(chatId, userId);
  console.log(chat);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
