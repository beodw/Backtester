import 'next-auth/jwt';
declare module 'next-auth/jwt' {
  interface JWT {
    driveAccessToken?: string;
    driveRefreshToken?: string;
    driveExpiresAt?: number;
  }
}