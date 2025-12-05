import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { db } from '../src/lib/db';
import { sql } from 'drizzle-orm';

function flattenProvider(invocation: any) {
  if (!invocation) return null;
  if (invocation.result && typeof invocation.result === 'string') {
    try {
      const parsed = JSON.parse(invocation.result);
      if (parsed?.provider) {
        return parsed.provider;
      }
    } catch {
      return null;
    }
  }
  if (invocation.result && typeof invocation.result === 'object' && invocation.result.provider) {
    return invocation.result.provider;
  }
  return null;
}

function parseToolInvocations(raw: unknown) {
  if (!raw) return [];
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (Array.isArray(raw)) return raw;
  return [];
}

async function auditImageTools() {
  console.log('[audit] Fetching recent tool invocations...');
  const { rows } = await db.execute(sql`
    SELECT id, role, created_at, tool_invocations
    FROM messages
    WHERE tool_invocations IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 100
  `);

  const providerCounts: Record<string, number> = {};
  const imageMessages: Array<{ id: string; created_at: Date; provider: string | null }> = [];

  rows.forEach((row) => {
    const invocations = parseToolInvocations(row.tool_invocations);
    invocations.forEach((invocation: any) => {
      const provider = flattenProvider(invocation);
      if (provider) {
        providerCounts[provider] = (providerCounts[provider] ?? 0) + 1;
        const createdAtValue = row.created_at
          ? row.created_at instanceof Date
            ? row.created_at
            : new Date(row.created_at as string | number)
          : new Date();
        imageMessages.push({
          id: typeof row.id === 'string' ? row.id : String(row.id),
          created_at: createdAtValue,
          provider,
        });
      }
    });
  });

  console.log('\n[audit] Image generation counts by provider:');
  Object.entries(providerCounts).forEach(([provider, count]) => {
    console.log(` - ${provider}: ${count}`);
  });

  console.log('\n[audit] Most recent image tool messages:');
  imageMessages.slice(0, 10).forEach((entry) => {
    console.log(` - ${entry.created_at?.toISOString?.() ?? entry.created_at} | ${entry.provider} | message ${entry.id}`);
  });

  console.log('\n[audit] Done.');
  process.exit(0);
}

auditImageTools().catch((error) => {
  console.error('[audit] Failed to inspect tool invocations', error);
  process.exit(1);
});
