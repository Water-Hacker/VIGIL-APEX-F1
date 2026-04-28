import { makeSectoralAdapter } from './_sectoral-ministry.js';

makeSectoralAdapter({
  sourceId: 'minsante-health',
  baseUrl: 'https://www.minsante.cm',
  listingPaths: ['/marches-publics', '/passation-marches'],
});
