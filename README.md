<a href="https://t.me/AsPriceTrackerBot"> <img src="https://telegra.ph/file/081d452dd37708fb4777b.png" alt="Logo" style="border-radius:15px;"></a><br><br>

# [Price Tracker](https://t.me/AsPriceTrackerBot)

A Telegram bot that can track price of Amazon & flipkart products (more coming soon)

![Star](https://img.shields.io/github/stars/siddiquiaffan/price-tracker?label=Star&logo=Github)
![GitHub Follow](https://img.shields.io/github/followers/siddiquiaffan?label=Follow&logo=GitHub)
![State](https://img.shields.io/github/deployments/siddiquiaffan/price-tracker/github-pages?color=blue)

---

## Features

- Track Amazon Product.
- Track Flipkart Product.
- Notify on every price change.
- Broadcast (Admin).
- API support.

---

## How to use

> To use this bot in your Telegram, [click here](t.me/AsPriceTrackerBot)

/start - Start the bot <br>
/help - get this message <br>
/track {Product Link} - Add product to tracking list <br>
/stop {Tracking ID} - Stop tracking <br>
/list - Get list of products that are being tracked <br>

---

## Deploy

**NOTE** - We're now using https proxy for sending requests. So add your proxy url in env as `PROXY` 

[![Deploy with Heroku](https://www.herokucdn.com/deploy/button.svg "Deploy with Heroku")](https://heroku.com/deploy?template=https://github.com/siddiquiaffan/price-tracker "Deploy with Heroku")

[![Deploy on Railway](https://railway.app/button.svg "Deploy on Railway")](https://railway.app/new/template?template=https://github.com/siddiquiaffan/price-tracker&envs=ADMINS,BOT_TOKEN,DB_URL,WORKER_URL,API_KEY,LIMIT&ADMINSDesc=Telegarm+ids+of+admins+separated+by+space&BOT_TOKENDesc=Get+Your+Bot+Token+From+@BotFather.&DB_URLDesc=Create+A+Database+In+Mongodb+And+Get+URL.&WORKER_URLDesc=Paste+worker.js+code+in+Cloudfare+Worker+and+get+url.&API_KEYDesc=Any+secret+key+to+access+API&LIMITDesc=Limit+of+products+to+track+per+user. "Deploy on Railway")

Deploy locally:
    
    - Clone Repository
    - Install Dependencies (npm install)
    - Create .env file and fill it with your details.
    - Start App (npm start)

---

### POST-DEPLOYMENT
**Setup bot:** Get your deployment url and navigate to {YOUR_DEPLOYMENT_URL}/setup
```
Example: https://price-tracker.herokuapp.com/setup
```
=> Replace `https://price-tracker.herokuapp.com/` with your deployment url.

---
## Contributing

- Fork this repo ![fork](https://img.shields.io/github/forks/siddiquiaffan/price-tracker?label=fork&logo=Github)
- Add your changes
- Create a pull request

---

## NOTE

- Do not clone this repo (You can fork it instead)
- Use this bot at your own risk
- This bot can be a little bit slow because of using Cloudflare workers for scraping product data <br> 
(To avoid IP blocking from Amazon & Flipkart)

---

## License

[LICENSE](https://github.com/siddiquiaffan/price-tracker/blob/main/LICENSE)