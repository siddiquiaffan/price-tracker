/**
 * Amazon CSS selectors with fallbacks. Data is preferred from JSON-LD; these are
 * the fallback when structured data is missing. Marked "needs verification"
 * against live captures — see tests/fixtures/README.md.
 */
export const amazonSelectors = {
  title: ['#productTitle', 'h1#title', 'h1 span#productTitle'],
  price: [
    '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
    '#corePrice_feature_div .a-offscreen',
    'span.a-price.aok-align-center.priceToPay span.a-offscreen',
    '#priceblock_dealprice',
    '#priceblock_ourprice',
    '#priceblock_saleprice',
    '.a-price .a-offscreen',
  ],
  availability: ['#availability span', '#availability', '#outOfStock', '#availability_feature_div'],
  image: ['#landingImage', '#imgBlkFront', '#main-image', '#imgTagWrapperId img'],
} as const;
