import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import type { Account } from 'next-auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
];

async function persistGoogleTokens(email: string, account?: Account | null) {
  if (!account || account.provider !== 'google') {
    return;
  }

  const updates: Partial<typeof users.$inferInsert> = {};

  if (account.access_token) {
    updates.googleAccessToken = account.access_token;
  }
  if (account.refresh_token) {
    updates.googleRefreshToken = account.refresh_token;
  }
  if (account.expires_at) {
    updates.googleTokenExpiresAt = new Date(account.expires_at * 1000);
  }
  if (account.scope) {
    updates.googleScopes = account.scope;
  }

  if (Object.keys(updates).length === 0) {
    return;
  }

  await db.update(users).set(updates).where(eq(users.email, email));
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: 'consent',
          access_type: 'offline',
          response_type: 'code',
          scope: GOOGLE_SCOPES.join(' '),
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === 'google' && user.email) {
        try {
          // Check if user exists
          const existingUser = await db
            .select()
            .from(users)
            .where(eq(users.email, user.email))
            .limit(1);

          if (existingUser.length === 0) {
            // Create new user
            await db.insert(users).values({
              id: user.id || crypto.randomUUID(), // Use Google ID if available, else random
              email: user.email,
              name: user.name || 'Anonymous',
            });
          }

          await persistGoogleTokens(user.email, account);
          return true;
        } catch (error) {
          console.error('Error saving user to DB:', error);
          return false;
        }
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (user?.email) {
        token.email = user.email;
      }

      const email = token.email;

      if (email) {
        try {
          if (account?.provider === 'google') {
            await persistGoogleTokens(email, account);
          }
          // Always fetch the user from the database to ensure we have the correct ID
          const dbUser = await db
            .select()
            .from(users)
            .where(eq(users.email, email))
            .limit(1);

          if (dbUser.length > 0) {
            token.sub = dbUser[0].id;
          }
        } catch (error) {
          console.error('Error fetching user in JWT callback:', error);
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        if (token.sub) {
          session.user.id = token.sub;
        }
        if (token.email) {
          session.user.email = token.email as string;
        }
      }
      return session;
    },
  },
});
