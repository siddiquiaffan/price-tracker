import { getRandomId, getProductDetails } from "./utils.js"
import { manageProducts, manageUsers } from "./db.js"
import {API_KEY} from './config.js'
import express from 'express'
import bot from './bot.js'
import { webhookCallback } from "grammy"

//Globals
const port = process.env.PORT || 3000;
const app = express();

app.use(express.json());

app.get('/', async(req, res) => {
    const userId = Number(req.query.userId);
    if(userId) {
        try{
            const products = await manageProducts({ userId }, 'read');
            res.status(200).send(JSON.stringify(products));
        }catch(e){
            res.status(500).send(JSON.stringify({error: e.message}));
        }
    }else{
        res.status(500).send(JSON.stringify({error: 'Please pass a valid user id.'}))
    }
})

app.post('/', async(req, res) => {
    const {url, userId, email} = req.body;
    const merchant = url.replace('www.', '').split('//')[1].split('.')[0];
    if (userId && merchant.match(/amazon|flipkart/gi)) {
        try{
            const details = await getProductDetails(url, merchant);
            if (details.ok) {
                const tracking_id = getRandomId();
                await manageProducts({ tracking_id, email, userId, merchant, title: details.title, link: details.link, initPrice: details.price, price: details.price }, 'update');
                res.status(200).send(JSON.stringify({ok: true, tracking_id}));
            } else {
                res.status(500).send(JSON.stringify({error: 'Failed to add product to tracking list'}));
            }
        }catch(e){
            res.status(500).send(JSON.stringify({error: e.message}));
        }
    }else{
        res.status(503).send(JSON.stringify({error: 'Either url or userId is missing/incorrect'}))
    }
});

app.delete('/', async (req, res) => {
    const {tracking_id, userId} = req.body;
    if(tracking_id, userId) {
        try{
            await manageProducts({tracking_id, userId}, 'delete');
            res.status(200).send(JSON.stringify({ok: true}))
        }catch(e){
            res.status(500).send(JSON.stringify({error: e.message}))
        }
    }else{
        res.status(503).send(JSON.stringify({error: `Either tracking_id or userId is incorrect/missing.`}))
    }
})

app.get('/stats', async (req, res) => {
    try{
        const users = await manageUsers({}, 'read');
        const products = await manageProducts({}, 'read');
        let productCount = 0;
        products.result.map((p) => (p += item.users.length));
        res.status(200).send(JSON.stringify({users: users?.result?.length, products: productCount }))
    }catch(e){

    }
})

app.get('/info', async(req, res) => {
    const {authorization} = req.headers;
    console.log(authorization);
    if(authorization && authorization.replace('Bearer ','') == API_KEY){
        let users = (await manageUsers({}, 'read')).result;
        res.status(200).send(JSON.stringify(users.map(u => ({id: u.id, name: u.name, mail: u?.mail?.trim()}))))
    }
    res.send(JSON.stringify({error: 'Invalid API key'}))
})

// use bot webhook path
app.use('/bot', webhookCallback(bot, 'express'));

// set bot webhook, use req.url as webhook path
app.get('/setup', async (req, res) => {
    // get host name from req
    try {
        const host = req.hostname;
        bot.api.setWebhook(`https://${host}/bot`);
        res.send('ok');
    } catch (e) {
        console.log(e);
        res.send('error');
    };
})

app.listen(port, async () => console.log('listening to port ' + port));

// if NODE_ENV is development, start polling
if (process.env.NODE_ENV === 'development') {
    bot.start();
}