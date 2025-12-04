import { config } from 'dotenv';
config({ path: '.env.local' });

import { db } from '../src/lib/db';
import { chats, users } from '../src/lib/db/schema';
import { eq } from 'drizzle-orm';

async function main() {
  const email = process.argv[2];

  if (!email) {
    console.error('Usage: tsx scripts/clear-user-chats.ts <user-email>');
    process.exit(1);
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user) {
    console.error('No user found with email', email);
    process.exit(1);
  }

  const deletedChats = await db
    .delete(chats)
    .where(eq(chats.userId, user.id))
    .returning({ id: chats.id });

  console.log(`Deleted ${deletedChats.length} chats for ${email}`);
}

main().catch((error) => {
  console.error('Failed to clear chats:', error);
  process.exit(1);
});
