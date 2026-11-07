# LiveChat

Session-only chat. No database: everything is in memory and disappears when a chat ends or the server restarts.

## Run on your computer
1. Install Node.js 18+ from nodejs.org
2. In this folder: `npm install` then `npm start`
3. Open http://localhost:3000

## Optional: SMS verification (Twilio Verify)
Set these environment variables before `npm start`:
TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SID
Without them, sign-up works with no phone verification.

## Put it online (Render, free tier)
1. Put this folder in a GitHub repository.
2. On render.com: New > Web Service > connect the repo.
3. Build command: `npm install`   Start command: `npm start`
4. (Optional) add the three Twilio variables under Environment.
5. Open the https://...onrender.com link Render gives you.
