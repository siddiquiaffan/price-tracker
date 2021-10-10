const cheerio = require('cheerio');
const axios = require('axios');

const urlRegex = /^(?:(?:(?:https?|ftp):)?\/\/)(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,})))(?::\d{2,5})?(?:[/?#]\S*)?$/i;

const isUrl = (str) => { // Return true if string is a valid URL
    return urlRegex.test(str);
};

const getRandomId = () => [...Array(10)].map(i=>(~~(Math.random()*36)).toString(36)).join(''); // Return a random id 

const selectors = {
    amazon: {
        title: '#productTitle',
        price: '#priceblock_dealprice',
        image: '#landingImage'
    },
    flipkart: {
        price: '#container > div > div._2c7YLP.UtUXW0._6t1WkM._3HqJxg > div._1YokD2._2GoDe3 > div._1YokD2._3Mn1Gg.col-8-12 > div:nth-child(3) > div > div.dyC4hf > div.CEmiEU > div > div._30jeq3._16Jk6d',
        title: '.B_NuCI',
        image: '#container > div > div._2c7YLP.UtUXW0._6t1WkM._3HqJxg > div._1YokD2._2GoDe3 > div._1YokD2._3Mn1Gg.col-5-12._78xt5Y > div:nth-child(1) > div > div._3li7GG > div._1BweB8 > div._3kidJX > div.CXW8mj._3nMexc > img'
    }
}
const getProductDetails = async(url, merchant) => {
    const {data} = await axios.get(url, {headers: { "User-Agent": "Mozilla/5.0 (Windows NT 6.3; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/38.0.2125.111 Safari/537.36", }});
    try{
        const $ = cheerio.load(data);
        const selector = selectors[merchant];
        const link = new URL(url);
        if(merchant == 'amazon') link.searchParams.set('tag', 'asloot-21');
        return {
            price: Number($(selector.price).text().trim().replace(/[^0-9.]/g, '')),
            title: $(selector.title).text().trim(),
            image: $(selector.image).attr('src'),
            link: link.toString(),
        }
    }catch(e){
        console.log(e);
        return
    }
}

module.exports = { isUrl, getRandomId, getProductDetails };