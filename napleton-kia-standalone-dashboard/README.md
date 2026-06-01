# Napleton Kia Standalone Dashboard

This is a standalone React/Vite dashboard that connects directly to your existing Supabase tables:
- survey_followups
- service_ranker

## Run locally
1. Install Node.js from https://nodejs.org
2. Open Command Prompt in this folder
3. Run:
   npm install
   npm run dev

## Deploy to Vercel
Upload/import this project to Vercel. Use these environment variables:
- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY

The .env.local file is included for local testing.
