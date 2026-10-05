import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Google({
      authorization: {
        params: {
          access_type: 'offline',
          prompt: 'consent',
          scope: 'openid email profile https://www.googleapis.com/auth/drive.readonly',
        },
      },
    }),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.driveAccessToken = account.access_token ?? undefined;
        token.driveRefreshToken = account.refresh_token ?? undefined;
        token.driveExpiresAt = account.expires_at
          ? account.expires_at * 1000
          : undefined;
      }

      if (token.driveExpiresAt && Date.now() < token.driveExpiresAt - 60_000) {
        return token;
      }
      if (!token.driveRefreshToken) return token;

      try {
        const response = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: process.env.AUTH_GOOGLE_ID ?? '',
            client_secret: process.env.AUTH_GOOGLE_SECRET ?? '',
            grant_type: 'refresh_token',
            refresh_token: token.driveRefreshToken,
          }),
        });
        const refreshed = await response.json();
        if (!response.ok) throw new Error('Google token refresh failed.');

        token.driveAccessToken = refreshed.access_token;
        token.driveExpiresAt = Date.now() + Number(refreshed.expires_in) * 1000;
        token.driveRefreshToken = refreshed.refresh_token ?? token.driveRefreshToken;
      } catch {
        token.driveAccessToken = undefined;
        token.driveExpiresAt = undefined;
      }

      return token;
    },
  },
});