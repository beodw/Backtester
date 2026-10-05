# Algo Insights

## Automated ORB Google Drive setup

The Journal Reconstruction tab can load H1 candles from yearly Dukascopy ZIP files in Google Drive. Google OAuth tokens are held in the server-side Auth.js session; the browser receives only the chart candles and trade results.

1. Create a Google OAuth web client and enable the Google Drive API.
2. Add these authorized redirect URIs to the OAuth client:
	- `https://your-domain.example/api/auth/callback/google`
	- `http://localhost:9002/api/auth/callback/google` for local development.
3. Set these Vercel environment variables for the deployment environment:
	- `AUTH_SECRET`: a long random secret.
	- `AUTH_GOOGLE_ID`: the OAuth client ID.
	- `AUTH_GOOGLE_SECRET`: the OAuth client secret.
4. Deploy. Vercel installs dependencies listed in `package.json` during its build. If using a locked install command, regenerate and commit `package-lock.json` with `npm install` before deployment.
5. In Journal Reconstruction, choose **Run Automated ORB**, enter `EURUSD` or `SP500`, choose a year range of up to three years, and connect the Google account that can access the archive folders.

The expected Drive path is `My Drive/Trading Journals/Opening Range Break/Candle By Candle Journal/{PAIR}/M1_bid_ask_prices/{YEAR}.zip`. Each archive must contain exactly one Bid CSV and one Ask CSV. The Google OAuth consent screen must be published or the account must be listed as a test user.

Strategy sizing/target configuration is currently enabled for EURUSD and SP500 using the Colab `RR_TARGET` value. H1 bars are aligned to 4:30 AM America/New_York, with DST handled by the server's timezone database. The API limits a single run to three years to keep memory and response sizes bounded.
