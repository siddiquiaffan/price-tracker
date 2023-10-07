// Imports
import { Bot } from "grammy"
import { BOT_TOKEN, ADMINS, LIMIT } from "./config.js"
import { isUrl, getRandomId, getProductDetails, productCommonUrl } from "./utils.js"
import { manageProducts, manageUsers } from "./db.js"
import unshort from "./unshort.js"

const bot = new Bot(BOT_TOKEN); // Initialize bot

const reply_markup = {
  //common repky markup
  inline_keyboard: [
    [
      { text: "👨‍💻 Developer", url: "https://github.com/AffanTheBest" },
      { text: "🛒 Deals Channel", url: "https://t.me/aslootdeals" },
    ],
    [
      { text: "🔃 Updates", url: "https://t.me/asprojects" },
      { text: "💁‍♂️ Support", url: "https://t.me/assupportchat" },
    ],
  ],
};

const processUrl = async (msg, ctx) => {
  try {
    const url = await unshort(msg);
    const productUrl = "http" + url.split("http")[1].split(" ")[0].replace("dl.", "www.")

    if (isUrl(productUrl)) {
      const merchant = productUrl.replace("www.", "").split("//")[1].split(".")[0];

      if (merchant.match(/amazon|flipkart|snapdeal/gi)) {
        const noOfProducts = (await manageProducts({ userId: ctx.from.id }, "read"))?.result?.length;

        if (noOfProducts < LIMIT) {
          const sentMsg = await ctx.reply(`Tracking ${merchant} product...`, { reply_to_message_id: ctx.message.message_id });
          const details = await getProductDetails(productUrl, merchant);

          if (details.ok) {
            try {
              const tracking_id = getRandomId();
              await manageProducts(
                { tracking_id, userId: ctx.from.id, merchant, title: details.title, link: details.link, initPrice: details.price, price: details.price, },
                "update"
              );

              await ctx.api.editMessageText(
                ctx.chat.id, sentMsg.message_id,
                `<a href="${details.image}"> </a>\nTracking <b>${details.title}</b>\n\nCurrent Price: <b>${details.price}</b>\nLink: <a href="${details.link}">${merchant}</a>\n\nTo stop tracking send /stop_${tracking_id}`,
                { parse_mode: "HTML", reply_markup }
              );
            } catch (e) { }
          } else {
            await ctx.api.editMessageText(
              ctx.chat.id, sentMsg.message_id,
              `Sorry, I couldn't track this product. Make sure you've sent correct product link.`,
              { parse_mode: "Markdown", reply_markup }
            ).catch(e => { });
          }

        } else {
          ctx.reply("I'm sorry, but you can't add more products as you've already reached the maximum limit.\n\nPlease delete atleast one product. And try again.\n\nTo get list send /list",
            { reply_to_message_id: ctx.message.message_id }).catch(e => { });
        }

      } else {
        ctx.reply(`Sorry, I can't track this product. Cuz the link you sent is not a amazon or flipkart product link.`).catch(e => { });
      }
    } else {
      ctx.reply(`Sorry ${ctx.message.chat.first_name}, I can't track this product. Make sure you've sent correct product link.`).catch(e => { });
    }
  } catch (e) {
    console.error(e)
  }
}


bot.command("start", (ctx) => {
  // start command
  try {
    ctx.reply(
      `Hello ${ctx.message.chat.first_name}, I can track price for Amazon & Flipkart products (Soon more).\n\nCheck /help to get started.\n`,
      {
        reply_to_message_id: ctx.message.message_id,
        reply_markup,
      }
    ).catch(() => { })

    manageUsers({ id: ctx.message.from.id, name: ctx.message.from.first_name }, "update");
  } catch (e) {
    console.log("Error", e);
  }
});

bot.command("help", (ctx) => {
  // help command
  try {
    ctx.reply(
      `/start - Start the bot\n/help - get this message.\n/track {Product Link} - Add product to tracking list.\n/stop_{Tracking ID} - Stop tracking.\n/list - Get list of products that are being tracked.\n\nFor more help join @@assupportchat.`,
      {
        reply_to_message_id: ctx.message.message_id,
        reply_markup,
      }
    ).catch(() => { })
  } catch (e) { }
});


bot.command("track", async (ctx) => {
  const message = ctx.message.text.replace("/track ", "");
  processUrl(message, ctx);
});

bot.command("list", async (ctx) => {
  try {
    const products = await manageProducts({ 'users.userId': ctx.from.id }, "read");

    const list = products.result
      .map(
        (product) =>
          `<b>${product.title}</b>\nLast Price: ${product.price}\nLink: <a href="${product.link}">${product.merchant}</a>\nTo stop send /stop_${product.users.filter(u => u.userId == ctx.from.id)[0].tracking_id}`
      )
      .join("\n\n");

    ctx.reply(`Here is your tracking list:\n\n${list}`, {
      reply_to_message_id: ctx.message.message_id,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  } catch (e) {
    ctx.reply(
      "An error has beem occured please report it to admin. This my be due to you've added too many products."
    );
  }
});

bot.hears(/^\/stop_([a-z0-9])/, async (ctx) => {
  const tracking_id = ctx.message.text.replace("/stop_", "");

  const result = await manageProducts(
    { tracking_id, userId: ctx.from.id },
    "delete"
  );

  ctx.reply(
    result.ok
      ? `Stopped tracking product with tracking id ${tracking_id}`
      : `Sorry, I can't stop tracking product with tracking id ${tracking_id}.`
  );
});

bot.command("broadcast", async (ctx) => {
  if (ADMINS.includes(ctx.from.id)) {
    let msg = ctx.message.text.replace("/broadcast ", "");
    const inline_keyboard = ctx.message.text.split("inline_keyboard:")[1];

    msg = msg.replace("inline_keyboard:", "").replace(inline_keyboard, "");

    const users = await manageUsers({}, "read");
    await Promise.all(
      users.result.map(async (user) => {
        try {
          ctx.api.sendMessage(
            user.id,
            msg
              .replace(/{name}/gi, "`" + user.name + "`")
              .replace(/{id}/gi, user.id),
            {
              parse_mode: "Markdown",
              disable_web_page_preview: true,
              reply_markup: {
                inline_keyboard: inline_keyboard
                  ? JSON.parse(inline_keyboard)
                  : null,
              },
            }
          );
        } catch (e) { }
      })
    );
  }
});

bot.command("users", async (ctx) => {
  if (ADMINS.includes(ctx.from.id)) {
    let users = await manageUsers({}, "read");

    users =
      "List Of Users: \n\n" +
      users.result
        .map(
          (user) =>
            `${user.id} - <a href="tg://user?id=${user.id}">${user.name}</a>`
        )
        .join("\n");

    ctx.reply(users, { parse_mode: "HTML" });
  }
});

bot.command("stats", async (ctx) => {
  try {
    const [users, products] = await Promise.all([manageUsers, manageProducts].map(
      async (func) => await func({}, "read")

    ));
    let prodCount = 0;
    products.result.map(prod => prodCount += prod.users.length);

    ctx.reply(
      `Total Users: ${users.result.length}\nTotal Products: ${prodCount}`
    );
  } catch (e) {
    console.log(e)
  }
});

bot.on('::url', async ctx => {
  if (ctx.chat.type === "private") {
    const message = ctx.message.text;
    processUrl(message, ctx);
  }
});

bot.callbackQuery("stopTracking", async (ctx) => {
  const tracking_id =
    ctx.update?.callback_query?.message?.reply_markup?.inline_keyboard[1][0]?.text?.split(
      " - "
    )[1];

  const result = await manageProducts(
    { tracking_id, userId: ctx.from.id },
    "delete"
  );

  ctx.api.editMessageText(
    ctx.update?.callback_query?.message?.chat?.id,
    ctx.update?.callback_query?.message?.message_id,
    result.ok
      ? `Stopped tracking product with tracking id ${tracking_id}`
      : `Sorry, I can't stop tracking product with tracking id ${tracking_id}.`
  );
});

const track = async () => {
  try {
    const products = await manageProducts({}, "read");
    // Process 10 products at a time
    for (let i = 0; i < products.result.length; i = i + 10) {
      const temp = products.result.slice(i, i + 10)

      await Promise.all(
        temp.map(async (product) => {
          const details = await getProductDetails(product.link, product.merchant);

          if (details.ok && !isNaN(details.price) && details.price !== product.price) {
            try {
              await manageProducts({
                tracking_id: product.tracking_id,
                userId: product.userId,
                merchant: product.merchant,
                title: details.title,
                link: product.link,
                initPrice: product.price,
                price: details.price,
                users: product.users
              }, "update");

              await Promise.all(product.users.map(async user => {
                bot.api.sendMessage(
                  user.userId,
                  `<a href="${details.image}"> </a><b>Price has been ${details.price > product.price ? "increased" : "decreased"
                  } by ${Math.abs(product.price - details.price)}</b>. \n\n<b>${details.title
                  }</b>\n\nCurrent Price: <b>${details.price}</b>\nLink: <a href="${productCommonUrl(details.link, true)
                  }">${product.merchant}</a>\n\nTo stop tracking send /stop_${user.tracking_id
                  }`,
                  {
                    parse_mode: "HTML",
                    reply_markup: {
                      inline_keyboard: details?.link ? [
                        [{ text: "Buy Now", url: productCommonUrl(details.link, true) }],
                        [{ text: "Stop Tracking - " + user.tracking_id, callback_data: `stopTracking`, }]]
                        : []
                    }
                  }).catch(e => console.log(`🚀 ~ file: bot.js:255 ~ temp.map ~ e:`, e))
              }))

              // wait for 1 sec
              await new Promise(resolve => setTimeout(resolve, 1000))
            } catch (e) {
              console.log(`🚀 ~ file: bot.js:260 ~ temp.map ~ e:`, e)
              // bot.start()
              // wait for 5 sec
              await new Promise(resolve => setTimeout(resolve, 5000))
            }
          }
        })
      );
    }
  } catch (e) {
    console.log(`🚀 ~ file: bot.js:270 ~ track ~ e:`, e)
  }
};

bot.command("update", async (ctx) => {
  if (ADMINS.includes(ctx.from.id)) {
    track()
    ctx.reply("Updating products...")
  }
})

bot.catch((err) => {
  console.error("err");

  const ctx = err.ctx;
  console.error(`Error while handling update ${ctx.update.update_id}:`);

  const e = err.error;
  console.error("Error: ", e.description);

  // bot.start();
});

setInterval(track, 3600000); //Track every hr.

export default bot