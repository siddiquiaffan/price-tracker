import 'dotenv/config'

// Check if bot token is there or not
if(!process.env.BOT_TOKEN) {
    console.log("Please set the BOT_TOKEN environment variable.");
    process.exit(1);
}
// Check if bot token is there or not
if(!process.env.DB_URL) {
    console.log("Please set the DB_URL environment variable.");
    process.exit(1);
}

/** List of amdins (tg IDs) separated by space */
const ADMINS = process.env.ADMINS ?? ''

/** Telegram bot token */
const BOT_TOKEN = process.env.BOT_TOKEN ?? ''

/** HTTPS Proxy URL */
const HTTPS_PROXY = process.env.PROXY ?? ''

/** MongoDB URL */
const DB_URL = process.env.DB_URL ?? ''

/** Cloudflare Worker URL */
const WORKER_URL = process.env.WORKER_URL ?? ''

/** API Key - A random secure key to access api */
const API_KEY = process.env.API_KEY ?? '' // Generate any API Key and pass it when accessing the API.

/** Maximum number of products can be added by a user at a time. */
const LIMIT = Number(process.env.LIMIT) // Maximum number of products can be added by a user at a time.

export { ADMINS, BOT_TOKEN, DB_URL, WORKER_URL, API_KEY, LIMIT, HTTPS_PROXY }