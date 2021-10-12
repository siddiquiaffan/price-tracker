const cheerio = require('cheerio');
const axios = require('axios');
const {WORKER_URL} = require('./config');

const urlRegex = /^(?:(?:(?:https?|ftp):)?\/\/)(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,})))(?::\d{2,5})?(?:[/?#]\S*)?$/i;

const isUrl = (str) => { // Return true if string is a valid URL
    return urlRegex.test(str);
};

const getRandomId = () => [...Array(10)].map(i=>(~~(Math.random()*36)).toString(36)).join(''); // Return a random id 

const selectors = {
    amazon: {
        title: '#productTitle',
        price1: '#priceblock_dealprice', price2: '#priceblock_ourprice',
        image1: '#landingImage'
    },
    flipkart: {
        title: '.B_NuCI',
        price1: '._30jeq3._16Jk6d',
        image1: '#container > div > div._2c7YLP.UtUXW0._6t1WkM._3HqJxg > div._1YokD2._2GoDe3 > div._1YokD2._3Mn1Gg.col-5-12._78xt5Y > div:nth-child(1) > div > div._3li7GG > div._1BweB8 > div._3kidJX > div.CXW8mj._3nMexc > img',
    }
}
const getProductDetails = async(url, merchant) => {
    try{
        // console.log(encodeURIComponent(url));
        const res = await axios.get(`${WORKER_URL}/?url=${encodeURIComponent(url)}`, {
            headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 6.3; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/38.0.2125.111 Safari/537.36",
              },
        });
        const $ = cheerio.load(res.data);
        const selector = selectors[merchant];
        let link = new URL(url);
        if(merchant == 'amazon') link.searchParams.set('tag', 'asloot-21');
        link = link.toString();
        const {price, title, image} = {
            title: $(selector.title).text().trim(),
            price: Number($(selector.price1).text().trim().replace(/[^0-9.]/g, '')) || Number($(selector.price2).text().trim().replace(/[^0-9.]/g, '')),
            image: $(selector.image1).attr('src'),
        }
        if(!title || !price || !image) {
            return {ok: false}
        }
        return {ok: true, title, price, image, link}
    }catch(e){
        console.log(e);
        return {ok: false}
    }
}

module.exports = { isUrl, getRandomId, getProductDetails };