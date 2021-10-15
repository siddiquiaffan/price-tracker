require('dotenv').config()

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

module.exports = {
    ADMINS: process.env.ADMINS || '',
    BOT_TOKEN: process.env.BOT_TOKEN || '',
    DB_URL: process.env.DB_URL || '',
    WORKER_URL: process.env.WORKER_URL || '',
    API_KEY: process.env.API_KEY || '', // Generate any API Key and pass it when accessing the API.
}