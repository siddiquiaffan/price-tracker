import * as cheerio from 'cheerio'
import axios from 'axios'
import { WORKER_URL, HTTPS_PROXY } from './config.js'
import { HttpsProxyAgent } from 'https-proxy-agent';

const urlRegex = /^(?:(?:(?:https?|ftp):)?\/\/)(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,})))(?::\d{2,5})?(?:[/?#]\S*)?$/i;


/**
 * check if string is url or not
 * @param {string} str
 * @returns {boolean}
 */
const isUrl = (str) => { // Return true if string is a valid URL
  return urlRegex.test(str);
};

/**
 * Generate random string id
 * @returns {string}
 */
const getRandomId = () => [...Array(10)].map(i => (~~(Math.random() * 36)).toString(36)).join(''); 


const selectors = {
  amazon: {
    title: '#productTitle',
    // price1: 'span.a-price.a-text-price.a-size-medium.apexPriceToPay > span:nth-child(2)', price2: 'span.a-price.aok-align-center.priceToPay > span.a-offscreen',
    price1: '#tp_price_block_total_price_ww span',
    image1: '#landingImage'
  },
  flipkart: {
    title: '.B_NuCI',
    price1: '._30jeq3._16Jk6d',
    image1: '#container > div > div._2c7YLP.UtUXW0._6t1WkM._3HqJxg > div._1YokD2._2GoDe3 > div._1YokD2._3Mn1Gg.col-5-12._78xt5Y > div:nth-child(1) > div > div._3li7GG > div._1BweB8 > div._3kidJX > div.CXW8mj._3nMexc > img',
  },
  snapdeal: {
    title: '#productOverview > div.col-xs-14.right-card-zoom.reset-padding > div > div.pdp-fash-topcenter-inner.layout > div.row > div.col-xs-18 > h1',
    price1: '#buyPriceBox > div.row.reset-margin > div.col-xs-14.reset-padding.padL8 > div.disp-table > div.pdp-e-i-PAY-r.disp-table-cell.lfloat > span.pdp-final-price > span',
    image1: '#bx-slider-left-image-panel > li:nth-child(1) > img'
  }
}

/**
 * Get common url for the product
 * @param {string} link
 * @param {string} tag
*/
const productCommonUrl = (link, tag) => {
  const url = new URL(link?.replace("www.", ""));
  const merchant = url.hostname.split(".")[0];
  let id, commonUrl;
  switch (merchant) {
    case "amazon":
      id = link.match(
        /https?:\/\/(www\.)?(.*)amazon\.([a-z\.]{2,6})(\/d\/(.*)|\/(.*)\/?(?:dp|o|gp|-)\/)(aw\/d\/|product\/)?(B[0-9]{1}[0-9A-Z]{8}|[0-9]{9}(?:X|[0-9]))/i
      ).splice(-1)[0];
      commonUrl = "https://www.amazon.in/dp/" + id + `${tag ? ('?tag=' + 'asloot-21') : ''}`;
      break;
    case "flipkart":
      id = url.searchParams.get("pid");
      commonUrl = id ? "https://www.flipkart.com/product/p/itme?pid=" + id : link.includes('/p/itm') ? link.split('?')[0] : link;
      break;
    default:
      null;
  }

  return commonUrl;
};


/**
 * Make request to the url
 * @param {string} url 
 * @param {object} options
 */
const makeRequest = async (url, { method = 'GET', useProxy }) => {
  try {

    const options = { method, headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" } };
    if (useProxy) options.httpsAgent = new HttpsProxyAgent(HTTPS_PROXY);

    if (HTTPS_PROXY && useProxy)
      return await axios(url, options);

    // else if (WORKER_URL) {
    //   const url1 = new URL(WORKER_URL)
    //   url1.searchParams.set('url', url)

    //   return await axios(url1.toString(), options);
    // }

    else return await axios(url, options);
  } catch (err) {
    throw err;
  }
}

/**
 * Get product details from the url
 * @param {string} url 
 * @param {string} merchant 
 * @returns 
 */
const getProductDetails = async (url, merchant) => {
  try {
    const commonUrl = productCommonUrl(url);
    const res = await makeRequest(commonUrl, { useProxy: commonUrl.includes('amazon.') });

    const $ = cheerio.load(res.data);
    const selector = selectors[merchant];

    const priceEl = $(selector.price1) || $(selector.price2);
    if (!priceEl || !priceEl.text()?.trim())
      return { ok: false }

    const price = priceEl.text()?.split('.')[0]?.trim().replace(/^\D+|[^0-9.]/g, '');

    // const price = parseFloat($(selector.price1).text().trim().replace(/^\D+|[^0-9.]/g, '')) || parseFloat($(selector.price2).text().trim().replace(/^\D+|[^0-9.]/g, ''));

    const title = $(selector.title).text().trim();
    const image = $(selector.image1).attr('src');

    if (!title || !price)
      return { ok: false }

    return { ok: true, title, price, image, link: commonUrl }
  } catch (e) {
    console.log(e);
    return { ok: false }
  }
}

export { isUrl, getRandomId, getProductDetails, productCommonUrl };
