import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
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
          return true;
        } catch (error) {
          console.error('Error saving user to DB:', error);
          return false;
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      const email = user?.email || token.email;

      if (email) {
        try {
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
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
});
