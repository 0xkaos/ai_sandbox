import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from './index';
import { sql } from 'drizzle-orm';

async function audit() {
  console.log('--- Database Audit ---');
  
  try {
    // Check connection and list tables
    console.log('Checking tables in public schema...');
    const tables = await db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log('Tables found:', tables.rows.map(r => r.table_name));

    // Check users
    console.log('\nChecking users table...');
    try {
      const users = await db.execute(sql`SELECT * FROM users LIMIT 5`);
      console.log(`User count: ${users.rowCount}`);
      console.log('Sample users:', users.rows);
    } catch (e) {
      console.log('Error querying users:', e instanceof Error ? e.message : String(e));
    }

    // Check chats
    console.log('\nChecking chats table...');
    try {
      const chats = await db.execute(sql`SELECT * FROM chats LIMIT 5`);
      console.log(`Chat count: ${chats.rowCount}`);
      console.log('Sample chats:', chats.rows);
    } catch (e) {
      console.log('Error querying chats:', e instanceof Error ? e.message : String(e));
    }

    // Check messages
    console.log('\nChecking messages table...');
    try {
      const messages = await db.execute(sql`SELECT * FROM messages LIMIT 5`);
      console.log(`Message count: ${messages.rowCount}`);
      console.log('Sample messages:', messages.rows);
    } catch (e) {
      console.log('Error querying messages:', e instanceof Error ? e.message : String(e));
    }

  } catch (error) {
    console.error('Audit failed:', error);
  }
  
  console.log('\n--- Audit Complete ---');
  process.exit(0);
}

audit();
