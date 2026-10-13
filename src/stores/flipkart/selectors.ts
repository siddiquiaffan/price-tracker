/** Flipkart selectors (class names rotate often) with meta/JSON-LD fallbacks. */
export const flipkartSelectors = {
  title: ['span.B_NuCI', 'span.VU-ZEz', 'h1.yhB1nd', 'h1 span', 'h1'],
  price: ['div.Nx9bqj.CxhGGd', 'div._30jeq3._16Jk6d', 'div._30jeq3', 'div.Nx9bqj', 'div._16Jk6d'],
  image: ['img._396cs4', 'img._2r_T1I', 'img.DByuf4', 'img.q6DClP', 'img._53J4C-'],
  availability: ['div._16FRp0', 'div.Z8JjpR', 'div._1JL5IN'],
} as const;
