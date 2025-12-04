import { config } from 'dotenv';
config({ path: '.env.local' });
import { db } from '../src/lib/db';
import { users, chats, messages } from '../src/lib/db/schema';

async function main() {
  const dbUsers = await db.select().from(users);
  console.log('\nUsers:');
  console.log(dbUsers);

  const dbChats = await db.select().from(chats);
  console.log('\nChats:');
  console.log(dbChats);

  const dbMessages = await db.select().from(messages);
  console.log('\nMessages:');
  console.log(dbMessages.slice(-10));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
