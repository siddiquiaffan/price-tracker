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
    DB_URL: process.env.DB_URL || ''
}