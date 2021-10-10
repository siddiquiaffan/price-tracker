// Imports
const { Bot } = require("grammy");
const {BOT_TOKEN, ADMINS} = require("./config");
const {isUrl, getRandomId, getProductDetails} = require("./utils");
const {manageProducts, manageUsers} = require("./db");

const bot = new Bot(BOT_TOKEN); // Initialize bot

const reply_markup = { //common repky markup
    inline_keyboard: [
        [
            { text: "👨‍💻 Developer", url: "https://github.com/AffanTheBest" },
            { text: "🛒 Deals Channel", url: "https://t.me/aslootdeals" }
        ],
        [
            { text: "🔃 Updates", url: "https://t.me/asprojects" },
            { text: "💁‍♂️ Support", url: "https://t.me/assupportchat" }
        ]
    ]
}

bot.command('start', (ctx) => { // start command
    ctx.reply(`Hello ${ctx.message.chat.first_name}, I can track price for Amazon & Flipkart products (Soon more).\n\nCheck /help to get started.\n`,
    {
        reply_to_message_id: ctx.message.message_id,
        parse_mode: "Markdown",
        reply_markup
    });
    manageUsers({id: ctx.message.from.id, name: ctx.message.from.first_name}, 'update');
});

bot.command('help', (ctx) => { // help command
    ctx.reply(`/start - Start the bot\n/help - get this message.\n/track {Product Link} - Add product to tracking list.\n/stop {Tracking ID} - Stop tracking.\n/list - Get list of products that are being tracked.\n\nFor more help join @assuportchat.`,
    {
        reply_to_message_id: ctx.message.message_id,
        parse_mode: "Markdown",
        reply_markup
    });
});

bot.command('track', async ctx => {
    const productUrl = ctx.message.text.replace('/track ', '');
    if(isUrl(productUrl)) {
        const merchant = productUrl.replace('www.', '').split('//')[1].split('.')[0];
        if(merchant.match(/amazon|flipkart/gi)){
            const sentMsg = await ctx.reply(`Tracking ${merchant} product...`, {reply_to_message_id: ctx.message.message_id});
            const details = await getProductDetails(productUrl, merchant);
            const tracking_id = getRandomId();
            await manageProducts({tracking_id, userId: ctx.from.id, merchant, title: details.title, link: details.link, initPrice: details.price, price: details.price}, 'update');
            await ctx.api.editMessageText(ctx.chat.id, sentMsg.message_id,
                `[ ](${details.image})\nTracking *${details.title}*\n\nCurrent Price: *${details.price}*\nLink: [${merchant}](${details.link})\n\nTo stop tracking send ${'`/stop `'+ tracking_id}`,
                { parse_mode: "Markdown", reply_markup }
            );

        }else{
            ctx.reply(`Sorry, I can't track this product. Cuz the link you sent is not a amazon or flipkart product link.`);
        }
    }else{
        ctx.reply(`Sorry ${ctx.message.chat.first_name}, I can't track this product. Make sure you've sent correct product link.`);
    }
});

bot.command('list', async ctx => {
    const products = await manageProducts({userId: ctx.from.id}, 'read');
    const list = products.result.map((product) => `**${product.title}**\nLast Price: ${product.price}\nLink: [${product.merchant}](${product.link})\nTo stop send ${'`/stop `'+ product.tracking_id}`).join('\n\n');
    ctx.reply(`Here is your tracking list:\n\n${list}`, {reply_to_message_id: ctx.message.message_id, parse_mode: "Markdown", disable_web_page_preview: true});
})

bot.command('stop', async ctx => {
    const tracking_id = ctx.message.text.replace('/stop ', '');
    const result = await manageProducts({tracking_id, userId: ctx.from.id}, 'delete');
    ctx.reply(
        result.ok ?
            `Stopped tracking product with tracking id ${tracking_id}` :
            `Sorry, I can't stop tracking product with tracking id ${tracking_id}.`
    )
});

bot.command('broadcast', async ctx => {
    console.log(ctx.from.id, ADMINS);
    if(ADMINS.includes(ctx.from.id)){
        let msg = ctx.message.text.replace('/broadcast ', '');
        const inline_keyboard = ctx.message.text.split('inline_keyboard:')[1];
        msg = msg.replace('inline_keyboard:', '').replace(inline_keyboard, '');
        const users = await manageUsers({}, 'read');
        await Promise.all(users.result.map(async user => {
            ctx.api.sendMessage(user.id, msg.replace(/{name}/gi, user.name).replace(/{id}/gi, user.id), 
            {parse_mode: "Markdown", disable_web_page_preview: true, reply_markup: {inline_keyboard: JSON.parse(inline_keyboard)}});
        }));
    }
})

bot.callbackQuery('stopTracking', async ctx => {
    const tracking_id = ctx.update?.callback_query?.message?.reply_markup?.inline_keyboard[1][0]?.text?.split(' - ')[1];
    const result = await manageProducts({tracking_id, userId: ctx.from.id}, 'delete');
    ctx.api.editMessageText(ctx.update?.callback_query?.message?.chat?.id, ctx.update?.callback_query?.message?.message_id,
        result.ok ?
            `Stopped tracking product with tracking id ${tracking_id}` :
            `Sorry, I can't stop tracking product with tracking id ${tracking_id}.`
    );
})

// console.log(Object.keys(bot));

const track = async() => {
    const products = await manageProducts({}, 'read');
    await Promise.all(products.result.map(async product => {
        const details = await getProductDetails(product.link, product.merchant);
        if(details.price !== product.price){
            await manageProducts({tracking_id: product.tracking_id, userId: product.userId, merchant: product.merchant, title: details.title, link: product.link, initPrice: product.price, price: details.price}, 'update');
            bot.api.sendMessage(product.userId, `[ ](${details.image})*Price has been ${product.price > details.price ? 'decreased' : 'increased'} by ${Math.abs(product.price - details.price)}*. \n\n*${details.title}*\n\nCurrent Price: *${details.price}*\nLink: [${product.merchant}](${details.link})\n\nTo stop tracking send ${'`/stop `'+ product.tracking_id}`, 
                {parse_mode: "Markdown", reply_markup: {inline_keyboard: [
                    [{text: 'Buy Now', url: details.link}],
                    [{text: 'Stop Tracking - ' + product.tracking_id, callback_data: `stopTracking`}]
                ]}}
            );
        }
    }));
}
setInterval(track, 10800000); //Track every 3 hrs
bot.start()