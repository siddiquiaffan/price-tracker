// Imports
const { Bot } = require("grammy");
const { BOT_TOKEN, ADMINS } = require("./config");
const { isUrl, getRandomId, getProductDetails } = require("./utils");
const { manageProducts, manageUsers } = require("./db");

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
    manageUsers({ id: ctx.message.from.id, name: ctx.message.from.first_name }, 'update');
});

bot.command('help', (ctx) => { // help command
    ctx.reply(`/start - Start the bot\n/help - get this message.\n/track {Product Link} - Add product to tracking list.\n/stop_{Tracking ID} - Stop tracking.\n/list - Get list of products that are being tracked.\n\nFor more help join @@assupportchat.`,
        {
            reply_to_message_id: ctx.message.message_id,
            reply_markup
        });
});

bot.command('track', async ctx => {
    const productUrl = ctx.message.text.replace('/track ', '');
    if (isUrl(productUrl)) {
        const merchant = productUrl.replace('www.', '').split('//')[1].split('.')[0];
        if (merchant.match(/amazon|flipkart/gi)) {
            const sentMsg = await ctx.reply(`Tracking ${merchant} product...`, { reply_to_message_id: ctx.message.message_id });
            const details = await getProductDetails(productUrl, merchant);
            if (details.ok) {
                const tracking_id = getRandomId();
                await manageProducts({ tracking_id, userId: ctx.from.id, merchant, title: details.title, link: details.link, initPrice: details.price, price: details.price }, 'update');
                await ctx.api.editMessageText(ctx.chat.id, sentMsg.message_id,
                    `<a href="${details.image}"> </a>\nTracking <b>${details.title}</b>\n\nCurrent Price: <b>${details.price}</b>\nLink: <a href="${details.link}">${merchant}</a>\n\nTo stop tracking send /stop_${tracking_id}`,
                    { parse_mode: "HTML", reply_markup }
                );
            } else {
                await ctx.api.editMessageText(ctx.chat.id, sentMsg.message_id, `Sorry, I couldn't track this product. Make sure you've sent correct product link.`, { parse_mode: "Markdown", reply_markup });
            }
        } else {
            ctx.reply(`Sorry, I can't track this product. Cuz the link you sent is not a amazon or flipkart product link.`);
        }
    } else {
        ctx.reply(`Sorry ${ctx.message.chat.first_name}, I can't track this product. Make sure you've sent correct product link.`);
    }
});

bot.command('list', async ctx => {
    const products = await manageProducts({ userId: ctx.from.id }, 'read');
    const list = products.result.map((product) => `<b>${product.title}</b>\nLast Price: ${product.price}\nLink: <a href="${product.link}">${product.merchant}</a>\nTo stop send /stop_${product.tracking_id}`).join('\n\n');
    ctx.reply(`Here is your tracking list:\n\n${list}`, { reply_to_message_id: ctx.message.message_id, parse_mode: "HTML", disable_web_page_preview: true });
})

bot.hears(/^\/stop_([a-z0-9])/, async ctx => {
    const tracking_id = ctx.message.text.replace('/stop_', '');
    const result = await manageProducts({ tracking_id, userId: ctx.from.id }, 'delete');
    ctx.reply(
        result.ok ?
            `Stopped tracking product with tracking id ${tracking_id}` :
            `Sorry, I can't stop tracking product with tracking id ${tracking_id}.`
    )
})

bot.command('broadcast', async ctx => {
    if (ADMINS.includes(ctx.from.id)) {
        let msg = ctx.message.text.replace('/broadcast ', '');
        const inline_keyboard = ctx.message.text.split('inline_keyboard:')[1];
        msg = msg.replace('inline_keyboard:', '').replace(inline_keyboard, '');
        const users = await manageUsers({}, 'read');
        await Promise.all(users.result.map(async user => {
            try {
                ctx.api.sendMessage(user.id, msg.replace(/{name}/gi, '`' + user.name + '`').replace(/{id}/gi, user.id),
                    { parse_mode: "Markdown", disable_web_page_preview: true, reply_markup: { inline_keyboard: inline_keyboard ? JSON.parse(inline_keyboard) : null } });
            } catch (e) { }
        }));
    }
})

bot.command('users', async ctx => {
    if (ADMINS.includes(ctx.from.id)) {
        let users = await manageUsers({}, 'read');
        users = 'List Of Users: \n\n' + users.result.map(user => `${user.id} - <a href="tg://user?id=${user.id}">${user.name}</a>`).join('\n');
        ctx.reply(users, { parse_mode: "HTML" });
    }
})

bot.command('stats', async ctx => {
    const users = await manageUsers({}, 'read');
    const products = await manageProducts({}, 'read');
    ctx.reply(`Total Users: ${users.result.length}\nTotal Products: ${products.result.length}`);
})

bot.callbackQuery('stopTracking', async ctx => {
    const tracking_id = ctx.update?.callback_query?.message?.reply_markup?.inline_keyboard[1][0]?.text?.split(' - ')[1];
    const result = await manageProducts({ tracking_id, userId: ctx.from.id }, 'delete');
    ctx.api.editMessageText(ctx.update?.callback_query?.message?.chat?.id, ctx.update?.callback_query?.message?.message_id,
        result.ok ?
            `Stopped tracking product with tracking id ${tracking_id}` :
            `Sorry, I can't stop tracking product with tracking id ${tracking_id}.`
    );
})

const track = async () => {
    const products = await manageProducts({}, 'read');
    await Promise.all(products.result.map(async product => {
        const details = await getProductDetails(product.link, product.merchant);
        if (details.price !== product.price) {
            await manageProducts({ tracking_id: product.tracking_id, userId: product.userId, merchant: product.merchant, title: details.title, link: product.link, initPrice: product.price, price: details.price }, 'update');
            bot.api.sendMessage(product.userId, `<a href="${details.image}"> </a><b>Price has been ${product.price > details.price ? 'increased' : 'decreased'} by ${Math.abs(product.price - details.price)}</b>. \n\n<b>${details.title}</b>\n\nCurrent Price: <b>${details.price}</b>\nLink: <a href="${details.link}">${product.merchant}</a>\n\nTo stop tracking send /stop_${product.tracking_id}}`,
                {
                    parse_mode: "HTML", reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Buy Now', url: details.link }],
                            [{ text: 'Stop Tracking - ' + product.tracking_id, callback_data: `stopTracking` }]
                        ]
                    }
                }
            );
        }
    }));
}

setInterval(track, 3600000); //Track every hr.

bot.start().then(() => console.log('Bot launched!'));