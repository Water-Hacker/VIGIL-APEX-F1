import { makeSectoralAdapter } from './_sectoral-ministry.js';

makeSectoralAdapter({
  sourceId: 'minee-energy',
  baseUrl: 'https://www.minee.gov.cm',
  listingPaths: ['/marches', '/appels-offres', '/decisions-attribution'],
});
