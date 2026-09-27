import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { env } from './env';
import { UserService } from '../services/user.service';

export function configurePassport() {
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          callbackURL: env.GOOGLE_CALLBACK_URL,
        },
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const email = profile.emails?.[0]?.value;
            if (!email) {
              return done(new Error('No email associated with Google account'), undefined);
            }

            const user = await UserService.findOrCreateGoogleUser({
              googleId: profile.id,
              email,
              name: profile.displayName || email.split('@')[0],
              avatarUrl: profile.photos?.[0]?.value,
            });

            return done(null, user);
          } catch (err) {
            return done(err as Error, undefined);
          }
        }
      )
    );
  } else {
    console.warn('⚠️ Google OAuth credentials not configured in .env (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing)');
  }

  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await UserService.findUserById(id);
      done(null, user || false);
    } catch (err) {
      done(err, null);
    }
  });
}

export default passport;
