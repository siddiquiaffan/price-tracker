import axios from 'axios';

const merchants = [
    'amazon',
    'flipkart',
    'snapdeal',
    'ajio',
    'myntra',
    'jabong',
    'bewakoof',
    'limeroad',
    'shein',
]

/**
 * Get the long url from a short url
 * @param {string} url 
 * @returns 
 */
const unshort = async (url) => {
    const extractUrl = req => req?.request?.res?.responseUrl ||
        req?.request?._redirectable?._currentUrl ||
        req?.request?._currentUrl ||
        req?.request?._options?.href ||
        'https://' + req?.request?.host + req?.request?.path;


    const host = new URL(url).hostname.split(".");
    const merchant = host[0] === 'www' ? host[1] : host[0];

    if (merchants.includes(merchant))
        return url;

    let longUrl = url;

    try {
        const req = await axios.get(url);
        const result = extractUrl(req);
        longUrl = result ? result : url;
    } catch (err) {
        const result = extractUrl(err);
        longUrl = result ? result : url;
    }
    return longUrl;
}


export default unshort;